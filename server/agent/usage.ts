import { AsyncLocalStorage } from 'async_hooks'
import type { UsageSnapshot } from '../types.js'

// Per-run token accounting.
//
// Threading a meter through planner → executor → critic → synthesizer by hand
// would touch every signature, and the swarm runs tasks concurrently, so a
// module-level counter would mix runs together. AsyncLocalStorage gives each
// run its own meter that follows the async call tree — including parallel
// branches — with no plumbing.

export class UsageMeter {
  promptTokens = 0
  completionTokens = 0
  calls = 0
  byModel: Record<string, number> = {}
  readonly startedAt = Date.now()

  record(model: string, usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null) {
    this.calls += 1
    this.byModel[model] = (this.byModel[model] ?? 0) + 1
    this.promptTokens += usage?.prompt_tokens ?? 0
    this.completionTokens += usage?.completion_tokens ?? 0
  }

  snapshot(): UsageSnapshot {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      calls: this.calls,
      byModel: { ...this.byModel },
      elapsedMs: Date.now() - this.startedAt,
    }
  }
}

const store = new AsyncLocalStorage<UsageMeter>()

/** Run `fn` with `meter` as the ambient meter for every LLM call it makes. */
export function runWithMeter<T>(meter: UsageMeter, fn: () => Promise<T>): Promise<T> {
  return store.run(meter, fn)
}

export function currentMeter(): UsageMeter | undefined {
  return store.getStore()
}

/** Record a completion against the ambient meter, if there is one. */
export function recordUsage(
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
): void {
  store.getStore()?.record(model, usage)
}

export const EMPTY_USAGE: UsageSnapshot = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
  byModel: {},
  elapsedMs: 0,
}
