import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'

// ── Live view of the plan as a graph ──────────────────────────────────────────
// The planner emits a DAG: every task lists the tasks whose results it needs,
// and anything with no unmet dependency runs at the same time. Showing that
// structure — rather than a flat checklist — is the difference between "the
// agent is doing things" and "three specialists are working, two in parallel".

export interface SwarmTask {
  id: string
  description: string
  role?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  dependsOn?: string[]
  durationMs?: number
}

export const ROLE_META: Record<string, { icon: string; label: string; accent: string }> = {
  researcher: { icon: '🔍', label: 'Researcher', accent: 'text-sky-300' },
  writer: { icon: '✍️', label: 'Writer', accent: 'text-amber-300' },
  analyst: { icon: '📊', label: 'Analyst', accent: 'text-violet-300' },
  generalist: { icon: '🤖', label: 'Agent', accent: 'text-emerald-300' },
}

export const roleMeta = (role?: string) => ROLE_META[role ?? 'generalist'] ?? ROLE_META.generalist

/**
 * Group tasks into execution waves.
 * Mirrors the server's scheduler: a plan with no declared dependencies is a
 * strict chain (one task per wave), and unknown ids are ignored so a stray
 * dependency can never hide a task from the graph.
 */
export function toWaves(tasks: SwarmTask[]): SwarmTask[][] {
  if (tasks.length === 0) return []
  const declared = tasks.some((t) => t.dependsOn?.length)
  if (!declared) return tasks.map((t) => [t])

  const ids = new Set(tasks.map((t) => t.id))
  const deps = new Map(
    tasks.map((t) => [t.id, (t.dependsOn ?? []).filter((d) => d !== t.id && ids.has(d))] as const)
  )

  const waves: SwarmTask[][] = []
  const placed = new Set<string>()
  let remaining = [...tasks]

  while (remaining.length) {
    const wave = remaining.filter((t) => (deps.get(t.id) ?? []).every((d) => placed.has(d)))
    // A cycle would leave nothing runnable — emit the rest as one wave rather
    // than looping forever.
    const batch = wave.length ? wave : remaining
    waves.push(batch)
    batch.forEach((t) => placed.add(t.id))
    remaining = remaining.filter((t) => !placed.has(t.id))
  }
  return waves
}

function StatusDot({ status }: { status: SwarmTask['status'] }) {
  if (status === 'done') return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
  if (status === 'failed') return <span className="shrink-0 text-xs text-rose-400">✕</span>
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-300" />
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-white/15" />
}

export default function SwarmGraph({ tasks }: { tasks: SwarmTask[] }) {
  const waves = toWaves(tasks)
  if (!waves.length) return null

  return (
    <div className="space-y-2">
      {waves.map((wave, wi) => (
        <div key={wi} className="relative">
          {/* Connector from the previous wave */}
          {wi > 0 && <div className="mx-auto mb-2 h-3 w-px bg-gradient-to-b from-emerald-400/0 to-emerald-400/40" />}

          {wave.length > 1 && (
            <div className="mb-1.5 flex items-center gap-2 pl-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300/60">
                {wave.length} in parallel
              </span>
              <span className="h-px flex-1 bg-white/5" />
            </div>
          )}

          <div className={wave.length > 1 ? 'grid gap-1.5 sm:grid-cols-2' : 'space-y-1.5'}>
            {wave.map((task) => {
              const meta = roleMeta(task.role)
              const active = task.status === 'running'
              return (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={
                    active
                      ? 'flex items-start gap-2 rounded-xl border border-emerald-400/35 bg-emerald-400/10 px-2.5 py-2'
                      : 'flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2'
                  }
                >
                  <span className="mt-0.5 w-5 shrink-0 text-center text-sm">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[10px] font-medium uppercase tracking-wider ${meta.accent}`}>
                      {meta.label}
                      {task.durationMs ? (
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-white/30">
                          {(task.durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : null}
                    </div>
                    <div
                      className={
                        task.status === 'done'
                          ? 'text-[13px] leading-snug text-white/40 line-through decoration-white/20'
                          : task.status === 'running'
                            ? 'text-[13px] leading-snug text-white'
                            : 'text-[13px] leading-snug text-white/45'
                      }
                    >
                      {task.description}
                    </div>
                  </div>
                  <div className="mt-0.5">
                    <StatusDot status={task.status} />
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
