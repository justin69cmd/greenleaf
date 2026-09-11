import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarPlus, Check, ExternalLink, Loader2, X } from 'lucide-react'
import {
  addCalendarEvents,
  connectCalendarUrl,
  extractCalendarEvents,
  type ProposedEvent,
} from '@/api'

// Review-then-write. The plan is read, events are proposed, and nothing
// touches the real calendar until these checkboxes are confirmed.
export default function CalendarSheet({
  token,
  runId,
  text,
  onClose,
}: {
  token: string
  runId?: string
  text?: string
  onClose: () => void
}) {
  const [events, setEvents] = useState<ProposedEvent[]>([])
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<{ title: string; link: string }[] | null>(null)

  useEffect(() => {
    extractCalendarEvents(token, { runId, text })
      .then((res) => {
        setEvents(res.events)
        setConnected(res.calendarConnected)
        // Everything without a clash starts ticked; clashes are opt-in.
        setChosen(new Set(res.events.map((e, i) => (e.clashes?.length ? -1 : i)).filter((i) => i >= 0)))
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [token, runId, text])

  const toggle = (i: number) =>
    setChosen((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })

  const write = async () => {
    setWriting(true)
    setError('')
    try {
      const picked = events.filter((_, i) => chosen.has(i))
      const res = await addCalendarEvents(token, picked)
      setAdded(res.created)
      if (res.failed.length) {
        setError(`${res.failed.length} could not be added: ${res.failed.map((f) => f.title).join(', ')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setWriting(false)
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  const duration = (a: string, b: string) => `${Math.round((Date.parse(b) - Date.parse(a)) / 60000)} min`

  return (
    <div
      className="menu-overlay fixed inset-0 z-[11000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-emerald-400/30 bg-neutral-950/95 p-7 shadow-2xl"
        style={{ boxShadow: '0 0 30px rgba(16,185,129,0.18)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="flex items-center gap-2 font-classy text-2xl italic text-white">
          <CalendarPlus className="h-5 w-5 text-emerald-400" />
          {added ? 'Added to your calendar' : 'Add this to your calendar'}
        </h2>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the plan…
          </div>
        )}

        {!loading && added && (
          <div className="mt-4 space-y-2">
            {added.map((a) => (
              <a
                key={a.link || a.title}
                href={a.link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-2.5 text-sm text-emerald-100 transition-colors hover:bg-emerald-400/15"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="flex-1 truncate">{a.title}</span>
                {a.link && <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />}
              </a>
            ))}
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-full border border-white/10 bg-white/5 py-2.5 text-sm text-neutral-300 transition-colors hover:text-white"
            >
              Done
            </button>
          </div>
        )}

        {!loading && !added && (
          <>
            <p className="mt-1 text-sm text-neutral-400">
              {events.length === 0
                ? 'Nothing in this plan is tied to a specific time.'
                : `${events.length} event${events.length === 1 ? '' : 's'} found. Pick what to add — nothing is written until you confirm.`}
            </p>

            <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
              {events.map((e, i) => (
                <label
                  key={`${e.title}-${e.start}`}
                  className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    chosen.has(i)
                      ? 'border-emerald-400/40 bg-emerald-400/[0.07]'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(i)}
                    onChange={() => toggle(i)}
                    className="mt-0.5 accent-emerald-400"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{e.title}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {when(e.start)} · {duration(e.start, e.end)}
                    </p>
                    {e.notes && <p className="mt-1 text-xs text-neutral-500">{e.notes}</p>}
                    {e.clashes?.length ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        Clashes with {e.clashes.map((c) => c.title).join(', ')}
                      </p>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>

            {error && <p className="mt-3 text-sm text-red-400/90">{error}</p>}

            {events.length > 0 &&
              (connected ? (
                <button
                  onClick={write}
                  disabled={writing || chosen.size === 0}
                  className="glow-border mt-4 w-full rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-400/25 disabled:opacity-40"
                >
                  {writing
                    ? 'Adding…'
                    : `Add ${chosen.size} event${chosen.size === 1 ? '' : 's'} to Google Calendar`}
                </button>
              ) : (
                <>
                  <a
                    href={connectCalendarUrl(token)}
                    className="glow-border mt-4 block w-full rounded-full border border-emerald-300/60 bg-emerald-400/15 py-2.5 text-center text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-400/25"
                  >
                    Connect Google Calendar
                  </a>
                  <p className="mt-2 text-center text-xs text-neutral-500">
                    GreenLeaf asks only to add events — it never reads your existing ones beyond
                    checking these times for clashes.
                  </p>
                </>
              ))}
          </>
        )}
      </div>
    </div>
  )
}
