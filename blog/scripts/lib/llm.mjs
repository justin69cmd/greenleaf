// Minimal NVIDIA NIM chat client via fetch (no SDK dependency), with a small
// model-fallback chain — the same idea as the GreenLeaf app's server/agent/llm.ts.
import { sleep } from './util.mjs'

const BASE = 'https://integrate.api.nvidia.com/v1/chat/completions'
const PRIMARY = process.env.NVIDIA_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
const CHAIN = [
  PRIMARY,
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
].filter((v, i, a) => a.indexOf(v) === i)

export async function chat(messages, { temperature = 0.6, maxTokens = 2600, json = false } = {}) {
  const key = process.env.NVIDIA_API_KEY
  if (!key) throw new Error('NVIDIA_API_KEY is not set. Add it to blog/.env (free at https://build.nvidia.com).')

  let lastErr
  for (const model of CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = {
          model,
          messages: /nemotron/i.test(model)
            ? [{ role: 'system', content: '/no_think' }, ...messages]
            : messages,
          temperature,
          max_tokens: maxTokens,
        }
        if (json) body.response_format = { type: 'json_object' }
        const res = await fetch(BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        })
        if (res.status === 429) {
          lastErr = new Error('rate limited')
          await sleep(3000 * (attempt + 1))
          continue
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
          break // try next model
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

// Extract the first {...} JSON object from a model response (models sometimes
// wrap JSON in prose or code fences).
export function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {}
  }
  return null
}
