// Cooperative cancellation for an in-flight run.
//
// The LLM calls and tools are not individually abortable, so cancellation is
// checked at the seams: between executor steps, between tool calls, and
// between waves of the plan. A cancelled run stops within one step rather
// than instantly, which is fast enough to feel immediate and avoids leaving
// half-written files behind.

export class CancelledError extends Error {
  constructor(message = 'Run cancelled by the user') {
    super(message)
    this.name = 'CancelledError'
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError || (err as { name?: string })?.name === 'CancelledError'
}

/** Throw if the run has been cancelled. Call at every await boundary that matters. */
export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError()
}
