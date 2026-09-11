import OpenAI from 'openai'
import { recordUsage } from './usage.js'

// Centralized LLM access via NVIDIA's NIM API, with automatic model fallback.
//
// NVIDIA's endpoint (https://integrate.api.nvidia.com/v1) is OpenAI-compatible,
// so we use the standard OpenAI SDK pointed at it. When the primary model hits
// a 429 rate limit, we transparently retry the same request on the next model
// in the chain — each hosted model has its own quota bucket, so falling back
// keeps the agent working.

// Defaults re-benchmarked against this account's live catalog on 2026-09-04,
// after every model in the previous chain was retired. Each candidate was run
// through this module on four real prompts from the app — a tool call, a
// planner JSON plan, a critic verdict, and a clarifier question set.
//
// Kept (correct on all four):
//   nemotron-3-super-120b   tool 1.2s · plan 3.1s · critic 5.8s · clarify 3.8s
//   gpt-oss-20b             tool 1.9s · plan 13.9s · critic 6.7s
//   nemotron-3-ultra-550b   correct throughout, but often minutes per call —
//                           a last resort, not a working default.
//
// Rejected, and why (do not re-add without re-testing):
//   minimax-m3              ignores the `tools` parameter entirely
//   nemotron-3.5-lightning  emits plain-text reasoning with no <think> tags, so
//                           stripThink can't remove it and every JSON answer
//                           (critic, clarifier) fails to parse
//   kimi-k3, gemma-4-31b    request timeouts / ~19 min per call
//   deepseek-v4-*, mistral-nemotron   correct but multi-minute
//
// NOTE: appearing in models.list() does NOT mean a model is servable on this
// account — half the catalog returns 404 from the completions endpoint. The
// chain must be validated with real calls, not just the catalog listing.
const PRIMARY = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b'
const FALLBACKS = (
  process.env.NVIDIA_FALLBACK_MODELS || 'openai/gpt-oss-20b,nvidia/nemotron-3-ultra-550b-a55b'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const MODEL_CHAIN = [PRIMARY, ...FALLBACKS.filter((m) => m !== PRIMARY)]

// Chain for lightweight judgment calls (critic, clarify). This used to lead
// with a small 8B model for latency, but no small model on the current catalog
// returns parseable JSON — so it leads with the primary, which was also the
// fastest model measured. Kept as a separate, env-overridable chain so a
// genuinely fast small model can be dropped in when one appears.
const FAST_PRIMARY = process.env.NVIDIA_FAST_MODEL || PRIMARY
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
      // These endpoints are shared and queue heavily — the same prompt has
      // been observed at 4s and at 9 minutes. Cap the wait so a stuck model
      // fails over to the next one in the chain instead of hanging the run.
      timeout: Number(process.env.NVIDIA_TIMEOUT_MS ?? 120_000),
      // The chain is the retry strategy. SDK retries would multiply the
      // timeout above before we ever reach the next model.
      maxRetries: 0,
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
    // Catalog membership is necessary but not sufficient — many listed models
    // 404 from the completions endpoint on this account. A model that passes
    // this check can still be dead; the chain advances on 404 at call time.
    if (missing.length === MODEL_CHAIN.length) {
      console.warn('   Every model in the chain is missing — the agent will fail until NVIDIA_MODEL is updated.')
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

// The request never got a usable answer, but the model didn't refuse it — a
// timeout, a dropped connection, or a 5xx. On NVIDIA's shared endpoints this is
// the most common real failure: the model is fine, that instance is swamped.
// Treated like a rate limit so the chain advances instead of failing the call.
export function isTransient(err: unknown): boolean {
  const e = err as { status?: number; code?: string; name?: string; message?: string }
  if (typeof e?.status === 'number' && e.status >= 500) return true
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'APIConnectionError') return true
  if (
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT']
      .includes(e?.code ?? '')
  ) {
    return true
  }
  const msg = (e?.message ?? String(err)).toLowerCase()
  return msg.includes('timed out') || msg.includes('timeout') || msg.includes('connection error')
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

/**
 * Streaming version of stripThink: models that reason inline emit <think>…</think>
 * a token at a time, so suppress everything between the tags as it arrives. Also
 * holds back a partial "<" run in case it turns out to be the start of a tag.
 */
export function makeThinkFilter(): (delta: string) => string {
  let thinking = false
  let held = ''
  return (delta) => {
    let buf = held + delta
    held = ''
    let out = ''
    while (buf) {
      if (thinking) {
        const close = buf.indexOf('</think>')
        if (close === -1) {
          // Keep a tail that might be a partial closing tag.
          held = buf.slice(-8)
          return out
        }
        buf = buf.slice(close + 8)
        thinking = false
        continue
      }
      const open = buf.indexOf('<think>')
      if (open === -1) {
        // A trailing '<' may be the start of a tag arriving in the next chunk.
        const tail = buf.lastIndexOf('<')
        if (tail !== -1 && buf.length - tail < 7) {
          out += buf.slice(0, tail)
          held = buf.slice(tail)
        } else {
          out += buf
        }
        return out
      }
      out += buf.slice(0, open)
      buf = buf.slice(open + 7)
      thinking = true
    }
    return out
  }
}

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

/**
 * Read a streamed completion, forwarding visible tokens to `onToken`, and
 * return it in the same shape as a non-streamed call so the rest of the
 * pipeline (usage accounting, empty-response detection) is untouched.
 */
async function streamCompletion(
  nvidia: OpenAI,
  body: CreateBody,
  onToken: (text: string) => void
): Promise<ChatCompletion> {
  const stream = await nvidia.chat.completions.create({
    ...body,
    stream: true,
    stream_options: { include_usage: true },
  })

  const visible = makeThinkFilter()
  let content = ''
  let finish: string | null = null
  let usage: ChatCompletion['usage']
  let id = ''
  let modelName = body.model

  for await (const chunk of stream) {
    id ||= chunk.id
    modelName = chunk.model || modelName
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices[0]
    if (choice?.finish_reason) finish = choice.finish_reason
    const delta = choice?.delta?.content
    if (!delta) continue
    content += delta
    const shown = visible(delta)
    if (shown) onToken(shown)
  }

  return {
    id: id || 'stream',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: (finish ?? 'stop') as 'stop',
        logprobs: null,
      },
    ],
    ...(usage ? { usage } : {}),
  } as ChatCompletion
}

// Run a chat completion, falling back through MODEL_CHAIN on rate-limit errors.
// Non-rate-limit errors (e.g. a 400 from a malformed tool call) are re-thrown
// so the caller can apply its own recovery.
export async function chatWithFallback(
  params: ChatParams,
  onFallback?: (from: string, to: string, reason: string) => void,
  chain: string[] = MODEL_CHAIN,
  /**
   * Receive the answer token by token. Streaming is only used for calls with no
   * tools — assembling tool-call deltas would buy nothing, since the user never
   * sees those. Everything else (fallback, cooldowns, usage) is unchanged: the
   * chunks are reassembled into the same completion shape the caller expects.
   */
  onToken?: (text: string) => void
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
        const body = adjustForModel(params, model)
        const completion = stripThink(
          onToken && !body.tools?.length
            ? await streamCompletion(nvidia, body, onToken)
            : await nvidia.chat.completions.create(body)
        )
        // Bill this call to the run's meter (no-op outside a metered run).
        recordUsage(model, completion.usage)
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
        } else if (isTransient(err)) {
          // Short cooldown: the model isn't gone, this endpoint is struggling.
          cooldownUntil.set(model, Date.now() + 60_000)
          if (i < order.length - 1) {
            onFallback?.(model, order[i + 1], 'request timed out')
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
