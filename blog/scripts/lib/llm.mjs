// NVIDIA NIM chat client (no SDK). Auto-discovers a currently-available model so
// the pipeline keeps working when specific models reach end-of-life.
import { sleep } from './util.mjs'

const CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const MODELS_URL = 'https://integrate.api.nvidia.com/v1/models'

// Preferred models, in order — used if still available.
const PREFERRED = [
  process.env.NVIDIA_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  'meta/llama-3.3-70b-instruct',
  'qwen/qwen2.5-72b-instruct',
  'mistralai/mixtral-8x22b-instruct-v0.1',
].filter((v, i, a) => v && a.indexOf(v) === i)

let RESOLVED = null

async function listModels(key) {
  try {
    const r = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return []
    const d = await r.json()
    return (d.data || []).map((m) => m.id).filter(Boolean)
  } catch {
    return []
  }
}

// Score a model id for text generation; negative = skip (embeddings, vision, etc).
function rank(id) {
  const s = id.toLowerCase()
  if (/embed|rerank|vision|vila|clip|ocr|guard|safety|reward|retriev|parakeet|riva|codestral|stable|sdxl|flux|diffus/.test(s)) return -1
  let sc = 0
  if (/instruct|chat|nemotron/.test(s)) sc += 5
  if (/llama-3\.3|3\.3-70b|70b|72b|8x22b|large|405b/.test(s)) sc += 4
  if (/llama|qwen|mistral|mixtral|gemma|deepseek|nemotron|phi/.test(s)) sc += 2
  if (/\b(8b|7b|3b|1b|mini|small|nano|tiny)\b/.test(s)) sc -= 1
  return sc
}

async function resolveChain(key) {
  if (RESOLVED) return RESOLVED
  const avail = await listModels(key)
  if (!avail.length) { RESOLVED = PREFERRED.slice(); return RESOLVED } // listing failed → try configured
  const set = new Set(avail)
  const preferred = PREFERRED.filter((m) => set.has(m))
  const discovered = avail.filter((id) => rank(id) >= 0).sort((a, b) => rank(b) - rank(a)).slice(0, 6)
  RESOLVED = [...new Set([...preferred, ...discovered])]
  if (!RESOLVED.length) RESOLVED = avail.slice(0, 3)
  console.log(`[llm] using models: ${RESOLVED.slice(0, 3).join(', ')}${RESOLVED.length > 3 ? ' …' : ''}`)
  return RESOLVED
}

function deadModel(status, msg) {
  const m = (msg || '').toLowerCase()
  return status === 410 || status === 404 || m.includes('end of life') || m.includes('no longer available') || m.includes('does not exist') || m.includes('model not found')
}

export async function chat(messages, { temperature = 0.6, maxTokens = 4096, json = false } = {}) {
  const key = process.env.NVIDIA_API_KEY
  if (!key) throw new Error('NVIDIA_API_KEY is not set. Add it to blog/.env (free at https://build.nvidia.com).')

  const chain = await resolveChain(key)
  let lastErr
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i]
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = {
          model,
          messages: /nemotron/i.test(model) ? [{ role: 'system', content: '/no_think' }, ...messages] : messages,
          temperature,
          max_tokens: maxTokens,
        }
        if (json) body.response_format = { type: 'json_object' }
        const res = await fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        })
        if (res.status === 429) { lastErr = new Error('rate limited'); await sleep(3000 * (attempt + 1)); continue }
        if (!res.ok) {
          const t = await res.text()
          lastErr = new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`)
          if (deadModel(res.status, t)) { chain.splice(i, 1); i--; } // drop dead model, try next
          break
        }
        const data = await res.json()
        let content = data?.choices?.[0]?.message?.content?.trim() || ''
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim()
        if (content) return content
        lastErr = new Error('empty response')
      } catch (err) {
        lastErr = err
        await sleep(1500)
      }
    }
  }
  throw lastErr || new Error('LLM call failed')
}

export function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) { try { return JSON.parse(match[0]) } catch {} }
  return null
}
