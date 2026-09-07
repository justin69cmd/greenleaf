import type { Task, WSMessage } from '../types.js'
import { executeTask } from './executor.js'
import { throwIfCancelled, isCancelled, CancelledError } from './cancellation.js'

type Sender = (msg: WSMessage) => void

// ── Parallel plan execution ───────────────────────────────────────────────────
// A plan is a DAG: each task lists the tasks it needs results from, and
// everything with no unmet dependency runs at the same time. A research →
// research → write plan that used to take three sequential LLM rounds now runs
// the two research tasks together, so the wall-clock cost is the depth of the
// graph rather than its size.
//
// Concurrency is capped because the shared model quota is the real bottleneck:
// firing six tasks at once just trades a queue for a wall of 429s.
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.SWARM_CONCURRENCY ?? 3))

export interface SwarmOptions {
  goal: string
  tasks: Task[]
  send: Sender
  signal?: AbortSignal
  /** Optional recalled-memory block appended to every task's context. */
  memoryBlock?: string
  concurrency?: number
}

export interface CompletedTask {
  description: string
  result: string
}

/**
 * Normalise `dependsOn` into a clean, acyclic edge set.
 * The plan comes from an LLM, so it can name tasks that don't exist, name
 * itself, or describe a cycle — none of which may be allowed to deadlock a run.
 */
export function resolveDependencies(tasks: Task[]): Map<string, string[]> {
  const ids = new Set(tasks.map((t) => t.id))
  const declared = tasks.some((t) => t.dependsOn?.length)

  const edges = new Map<string, string[]>()
  tasks.forEach((task, i) => {
    if (!declared) {
      // No dependency information at all: fall back to the original strictly
      // sequential behaviour, where each task builds on the one before it.
      edges.set(task.id, i === 0 ? [] : [tasks[i - 1].id])
      return
    }
    const deps = (task.dependsOn ?? []).map(String).filter((d) => d !== task.id && ids.has(d))
    edges.set(task.id, [...new Set(deps)])
  })

  if (!declared) return edges

  // Break cycles by dropping the back edge that closes them, keeping the plan
  // runnable instead of rejecting it.
  const state = new Map<string, 0 | 1 | 2>() // unvisited | on stack | finished
  const visit = (id: string) => {
    state.set(id, 1)
    const deps = edges.get(id) ?? []
    const kept: string[] = []
    for (const dep of deps) {
      const s = state.get(dep) ?? 0
      if (s === 1) continue // back edge — drop it
      if (s === 0) visit(dep)
      kept.push(dep)
    }
    edges.set(id, kept)
    state.set(id, 2)
  }
  for (const task of tasks) if ((state.get(task.id) ?? 0) === 0) visit(task.id)

  return edges
}

/**
 * Execute a plan, running independent tasks concurrently.
 * Individual task failures are absorbed (the task is marked done with a note)
 * so one bad step can't sink the run; cancellation propagates as CancelledError.
 */
export async function runSwarm(opts: SwarmOptions): Promise<CompletedTask[]> {
  const { goal, tasks, send, signal, memoryBlock } = opts
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)

  const edges = resolveDependencies(tasks)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const pending = new Set(tasks.map((t) => t.id))
  const finished = new Set<string>()
  const results = new Map<string, CompletedTask>()
  const inflight = new Map<string, Promise<string>>()
  const order: CompletedTask[] = []

  const depth = maxDepth(tasks, edges)
  if (tasks.length > 1 && depth < tasks.length) {
    send({ type: 'log', payload: `🕸️ Plan is a graph — running ${tasks.length} tasks in ${depth} wave(s)` })
  }

  const launch = (task: Task): Promise<string> =>
    (async () => {
      const startedAt = Date.now()
      task.status = 'running'
      send({ type: 'task_start', payload: task })

      // Source material: the results this task declared it needs. Falling back
      // to everything finished so far keeps a dependency-less task informed.
      const deps = edges.get(task.id) ?? []
      const previous = deps.length
        ? deps.map((d) => results.get(d)).filter((r): r is CompletedTask => !!r)
        : [...results.values()]

      try {
        const result = await executeTask(task, send, { goal, previous, signal, memoryBlock })
        task.status = 'done'
        task.result = result
      } catch (err) {
        if (isCancelled(err)) {
          task.status = 'pending'
          throw err // surfaced via the settled-promise scan below
        }
        task.status = 'done'
        task.result = 'Step skipped — the AI service was busy.'
      }
      task.durationMs = Date.now() - startedAt

      const completed: CompletedTask = { description: task.description, result: task.result ?? '' }
      results.set(task.id, completed)
      order.push(completed)
      send({ type: 'task_done', payload: task })
      return task.id
    })()

  let cancelled: unknown = null

  while (finished.size < tasks.length) {
    if (!cancelled) {
      try {
        throwIfCancelled(signal)
      } catch (err) {
        cancelled = err
      }
    }
    if (cancelled) break

    // Start everything whose dependencies are satisfied, up to the cap.
    const ready = tasks.filter((t) => pending.has(t.id) && (edges.get(t.id) ?? []).every((d) => finished.has(d)))
    for (const task of ready) {
      if (inflight.size >= concurrency) break
      pending.delete(task.id)
      inflight.set(
        task.id,
        launch(task).catch((err) => {
          cancelled ??= err
          return task.id
        })
      )
    }

    if (inflight.size === 0) {
      // Nothing running and nothing runnable: a dependency can never be met.
      // Release the next pending task rather than spinning forever.
      const stuck = tasks.find((t) => pending.has(t.id))
      if (!stuck) break
      pending.delete(stuck.id)
      edges.set(stuck.id, [])
      inflight.set(
        stuck.id,
        launch(stuck).catch((err) => {
          cancelled ??= err
          return stuck.id
        })
      )
    }

    const doneId = await Promise.race(inflight.values())
    inflight.delete(doneId)
    if (byId.has(doneId)) finished.add(doneId)
  }

  // Let anything still running settle before unwinding, so a cancelled run
  // doesn't keep writing files after the client has been told it stopped.
  if (inflight.size) await Promise.allSettled(inflight.values())
  if (cancelled) throw isCancelled(cancelled) ? new CancelledError() : cancelled

  return order
}

/** Longest dependency chain — how many sequential waves the plan needs. */
function maxDepth(tasks: Task[], edges: Map<string, string[]>): number {
  const memo = new Map<string, number>()
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (seen.has(id)) return 1
    seen.add(id)
    const deps = edges.get(id) ?? []
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depthOf(x, new Set(seen)))) : 1
    memo.set(id, d)
    return d
  }
  return tasks.length ? Math.max(...tasks.map((t) => depthOf(t.id))) : 0
}
