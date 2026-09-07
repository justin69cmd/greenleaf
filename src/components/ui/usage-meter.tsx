import { Cpu, Coins, Timer } from 'lucide-react'

// Compact live telemetry for the run in flight: what the swarm is spending and
// which model it is actually landing on. The model line matters — the backend
// falls back down a chain when a model is rate-limited, and without this the
// only symptom is a quietly worse answer.

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  calls: number
  byModel: Record<string, number>
  elapsedMs: number
}

/** Strip the vendor prefix and version tail so "meta/llama-3.3-70b-instruct" reads as "llama-3.3-70b". */
function shortModel(id: string): string {
  const name = id.split('/').pop() ?? id
  return name.replace(/-instruct$/, '').replace(/-v\d+(\.\d+)?$/, '')
}

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export default function UsageMeter({ usage, className = '' }: { usage: Usage; className?: string }) {
  if (!usage || usage.calls === 0) return null

  const models = Object.entries(usage.byModel).sort((a, b) => b[1] - a[1])
  const primary = models[0]?.[0]
  const fellBack = models.length > 1

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/35 ${className}`}>
      <span className="flex items-center gap-1" title="Prompt + completion tokens across every model call">
        <Coins className="h-3 w-3" />
        {compact(usage.totalTokens)} tokens
      </span>
      <span className="flex items-center gap-1" title={`${usage.calls} model call(s)`}>
        <Cpu className="h-3 w-3" />
        {usage.calls} call{usage.calls === 1 ? '' : 's'}
      </span>
      <span className="flex items-center gap-1">
        <Timer className="h-3 w-3" />
        {(usage.elapsedMs / 1000).toFixed(1)}s
      </span>
      {primary && (
        <span
          className="truncate text-white/25"
          title={models.map(([m, c]) => `${m} × ${c}`).join('\n')}
        >
          {shortModel(primary)}
          {fellBack && <span className="text-amber-300/50"> +{models.length - 1} fallback</span>}
        </span>
      )}
    </div>
  )
}
