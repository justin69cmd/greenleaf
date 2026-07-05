import OpenAI from 'openai'

// Centralized LLM access via NVIDIA's NIM API, with automatic model fallback.
//
// NVIDIA's endpoint (https://integrate.api.nvidia.com/v1) is OpenAI-compatible,
// so we use the standard OpenAI SDK pointed at it. When the primary model hits
// a 429 rate limit, we transparently retry the same request on the next model
// in the chain — each hosted model has its own quota bucket, so falling back
// keeps the agent working.

// Defaults picked by benchmarking tool-calling on this account's catalog (2026-07-02):
// nemotron-super answered a tool-call prompt correctly in ~5s; minimax-m2.7 was
// correct but ~26s; minimax-m3 ignored tools; kimi-k2.6 emitted corrupt arguments.
const PRIMARY = process.env.NVIDIA_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
const FALLBACKS = (
  process.env.NVIDIA_FALLBACK_MODELS ||
  'minimaxai/minimax-m2.7,meta/llama-3.3-70b-instruct,meta/llama-3.1-8b-instruct'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const MODEL_CHAIN = [PRIMARY, ...FALLBACKS.filter((m) => m !== PRIMARY)]

// Small-first chain for lightweight judgment calls (critic, clarify) where
// latency matters more than depth — ~1-2s instead of ~5s per call.
const FAST_PRIMARY = process.env.NVIDIA_FAST_MODEL || 'meta/llama-3.1-8b-instruct'
export const FAST_CHAIN = [FAST_PRIMARY, ...MODEL_CHAIN.filter((m) => m !== FAST_PRIMARY)]

// Type aliases so callers don't import any provider SDK directly.
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool
export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
export type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion

let client: OpenAI | null = null
function nvidiaClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  }
  return client
}

// Boot-time check so a missing/rejected key is obvious in the server log
// instead of surfacing later as silent fallback answers.
export async function verifyLLMKey(): Promise<void> {
  if (!process.env.NVIDIA_API_KEY) {
    console.warn('⚠️  NVIDIA_API_KEY is not set in server/.env — the agent will only return fallback text.')
    console.warn('   Get a key at https://build.nvidia.com and add it to server/.env')
    return
  }
  try {
    const models = await nvidiaClient().models.list()
    const ids = new Set(models.data.map((m) => m.id))
    const missing = MODEL_CHAIN.filter((m) => !ids.has(m))
    console.log(`✅ NVIDIA API key OK — primary model: ${MODEL_CHAIN[0]}`)
    if (missing.length) {
      console.warn(`⚠️  Not in NVIDIA's model catalog (check for typos): ${missing.join(', ')}`)
    }
  } catch (err) {
    const status = (err as { status?: number })?.status
    console.warn(`⚠️  NVIDIA API check failed${status ? ` (HTTP ${status})` : ''} — the key in server/.env was rejected.`)
  }
}

export function isRateLimit(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string }
  if (e?.status === 429) return true
  if (e?.code === 'rate_limit_exceeded') return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return msg.includes('rate limit') || msg.includes('too many requests')
}

// A 413 (or context-length 400): the single request exceeds the model's input
// limit. Switching models won't necessarily help — the caller must shrink the
// request. Exported so the executor can react by trimming context.
export function isRequestTooLarge(err: unknown): boolean {
  const e = err as { status?: number; message?: string }
  if (e?.status === 413) return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return (
    msg.includes('request too large') ||
    msg.includes('reduce your message size') ||
    msg.includes('maximum context length')
  )
}

// Model id isn't in this account's catalog (renamed, retired, or gated).
// Treated like a rate limit so the chain advances instead of crashing the task.
function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string }
  if (e?.status === 404) return true
  const msg = (e?.message ?? String(err)).toLowerCase()
  return msg.includes('model not found') || msg.includes('no such model') || msg.includes('does not exist')
}

// Reasoning models (MiniMax-M2, Nemotron, DeepSeek-R1…) can emit <think>…</think>
// traces inline. Strip them so they never leak into tool loops or rendered Markdown.
function stripThink(completion: ChatCompletion): ChatCompletion {
  for (const choice of completion.choices) {
    const c = choice.message?.content
    if (typeof c === 'string' && c.includes('<think>')) {
      choice.message.content = c
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        // Truncated output can leave an unclosed <think> — drop it to the end.
        // If that empties the content, the empty-response fallback takes over.
        .replace(/<think>[\s\S]*$/, '')
        .trim()
    }
  }
  return completion
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Parse a "try again in 17m25.44s"-style hint if present; default to 60s.
function parseRetryMs(err: unknown): number {
  const msg = (err as { message?: string })?.message ?? String(err)
  const m = msg.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i)
  if (m) {
    const mins = m[1] ? parseInt(m[1], 10) : 0
    const secs = m[2] ? parseFloat(m[2]) : 0
    return Math.ceil((mins * 60 + secs) * 1000)
  }
  return 60_000
}

// Remember which models are rate-limited so we skip them until their quota resets,
// instead of wasting a round-trip on a known-dead model for every call.
const cooldownUntil = new Map<string, number>()

type CreateBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
type ChatParams = Omit<CreateBody, 'model' | 'stream'>

export interface ChatResult {
  completion: ChatCompletion
  model: string
}

// Per-model request tuning. Reasoning models (Nemotron, MiniMax, DeepSeek…)
// burn completion tokens "thinking" before the answer — a 1024 budget can be
// consumed entirely by reasoning, yielding an empty content string. Give them
// headroom, and switch Nemotron's reasoning off outright (the swarm never
// reads it; answers get faster and the whole budget goes to actual output).
function adjustForModel(params: ChatParams, model: string): CreateBody {
  const body = { ...params, model } as CreateBody
  // Models that think inline need budget headroom for reasoning + answer.
  // Nemotron is excluded: we disable its thinking below, so the caller's
  // budget is all answer — and a tight budget keeps generation fast.
  if (/minimax|deepseek|qwen3/i.test(model)) {
    body.max_tokens = Math.max(body.max_tokens ?? 1024, 4096)
  }
  if (/nemotron/i.test(model)) {
    const msgs = [...(body.messages ?? [])]
    const first = msgs[0]
    if (first?.role === 'system' && typeof first.content === 'string') {
      // Merge into the existing system prompt — a second system message can
      // confuse the model and degrade structured (JSON) output.
      if (!first.content.includes('/no_think')) {
        msgs[0] = { ...first, content: `/no_think\n${first.content}` }
      }
    } else {
      msgs.unshift({ role: 'system', content: '/no_think' })
    }
    body.messages = msgs
  }
  return body
}

// Run a chat completion, falling back through MODEL_CHAIN on rate-limit errors.
// Non-rate-limit errors (e.g. a 400 from a malformed tool call) are re-thrown
// so the caller can apply its own recovery.
export async function chatWithFallback(
  params: ChatParams,
  onFallback?: (from: string, to: string, reason: string) => void,
  chain: string[] = MODEL_CHAIN
): Promise<ChatResult> {
  const nvidia = nvidiaClient()
  let lastErr: unknown

  // Up to 2 rounds: if every model is rate-limited but a quota resets soon
  // (per-minute limits), wait briefly and try again instead of failing.
  for (let round = 0; round < 2; round++) {
    const now = Date.now()
    const ready = chain.filter((m) => (cooldownUntil.get(m) ?? 0) <= now)
    const order = ready.length ? ready : chain

    for (let i = 0; i < order.length; i++) {
      const model = order[i]
      try {
        const completion = stripThink(await nvidia.chat.completions.create(adjustForModel(params, model)))
        const msg = completion.choices[0]?.message
        // Empty answer with no tool calls = the model produced nothing usable
        // (e.g. reasoning consumed the whole budget). Try the next model.
        if (msg && !msg.tool_calls?.length && !msg.content?.trim() && i < order.length - 1) {
          console.warn(`[llm] ${model} returned empty content (finish: ${completion.choices[0]?.finish_reason}) — trying next model`)
          onFallback?.(model, order[i + 1], 'empty response')
          continue
        }
        return { completion, model }
      } catch (err) {
        lastErr = err
        const e = err as { status?: number; message?: string }
        console.warn(`[llm] ${model} failed (HTTP ${e?.status ?? '?'}): ${(e?.message ?? String(err)).slice(0, 300)}`)
        if (isModelUnavailable(err)) {
          // Bad/renamed model id — bench it for an hour and try the next one.
          cooldownUntil.set(model, Date.now() + 60 * 60_000)
          if (i < order.length - 1) {
            onFallback?.(model, order[i + 1], 'model unavailable')
            continue
          }
        } else if (isRateLimit(err)) {
          cooldownUntil.set(model, Date.now() + parseRetryMs(err))
          if (i < order.length - 1) {
            onFallback?.(model, order[i + 1], 'rate limit reached')
            continue
          }
        } else {
          throw err // 413, 400 tool_use_failed, etc. — caller handles
        }
      }
    }

    // All models are rate-limited. Per-minute limits reset within ~60s, so wait
    // them out (up to ~65s) instead of surfacing an error to the user.
    const soonest = Math.min(...chain.map((m) => cooldownUntil.get(m) ?? 0))
    const waitMs = soonest - Date.now()
    if (round === 0 && waitMs > 0 && waitMs <= 65_000) {
      onFallback?.('all models', chain[0], `rate limited — waiting ${Math.ceil(waitMs / 1000)}s for quota to reset`)
      await sleep(waitMs + 500)
      continue
    }
    break
  }
  throw lastErr
}
