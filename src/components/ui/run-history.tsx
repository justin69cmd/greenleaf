import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Search, Trash2, Clock, Loader2, History, FileText, Share2, Check, Link2 } from 'lucide-react'
import {
  fetchRuns,
  fetchRun,
  fetchShares,
  removeRun,
  shareRun,
  unshareRun,
  type RunSummary,
  type RunDetail,
  type ShareInfo,
} from '@/api'

// ── Run history drawer ────────────────────────────────────────────────────────
// Every completed run is persisted server-side against the signed-in account.
// This is how the user gets back to one: search it, reopen its answer in the
// chat, re-download its files, or delete it.

function relativeTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const STATUS_STYLE: Record<RunSummary['status'], string> = {
  done: 'bg-emerald-400/15 text-emerald-300',
  cancelled: 'bg-amber-400/15 text-amber-300',
  error: 'bg-rose-400/15 text-rose-300',
}

export default function RunHistory({
  token,
  onOpen,
  onClose,
}: {
  token: string
  onOpen: (run: RunDetail) => void
  onClose: () => void
}) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  // runId -> live share link, for the runs this account has published.
  const [shares, setShares] = useState<Record<string, ShareInfo>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError('')
      try {
        setRuns(await fetchRuns(token, q))
        setShares(await fetchShares(token).catch(() => ({})))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your history.')
      } finally {
        setLoading(false)
      }
    },
    [token]
  )

  // Debounce so typing a query doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [query, load])

  // Escape closes the drawer, matching the app's other panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const open = async (id: string) => {
    setOpeningId(id)
    try {
      onOpen(await fetchRun(token, id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that run.')
    } finally {
      setOpeningId(null)
    }
  }

  const remove = async (id: string) => {
    // Optimistic: the row disappears immediately, and comes back if the
    // delete is refused.
    const previous = runs
    setRuns((r) => r.filter((x) => x.id !== id))
    try {
      await removeRun(token, id)
    } catch {
      setRuns(previous)
      setError('Could not delete that run.')
    }
  }

  /** Publish a run (or copy the link it already has). */
  const share = async (id: string) => {
    setSharingId(id)
    setError('')
    try {
      const info = shares[id] ?? (await shareRun(token, id))
      setShares((prev) => ({ ...prev, [id]: info }))
      try {
        await navigator.clipboard.writeText(info.url)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 1800)
      } catch {
        /* clipboard blocked — the link is still in state, shown below the row */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share that run.')
    } finally {
      setSharingId(null)
    }
  }

  const revoke = async (id: string) => {
    try {
      await unshareRun(token, id)
      setShares((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke that link.')
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9600] bg-black/50 backdrop-blur-[2px]"
      />
      <motion.aside
        initial={{ x: -380, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -380, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="fixed inset-y-0 left-0 z-[9700] flex w-[min(380px,88vw)] flex-col border-r border-white/15 bg-neutral-950/85 backdrop-blur-xl"
        aria-label="Run history"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <History className="h-4 w-4 text-emerald-300" />
          <h2 className="flex-1 text-sm font-semibold text-white">Run history</h2>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your past runs…"
              className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && error && <p className="px-2 py-6 text-sm text-rose-300/80">{error}</p>}

          {!loading && !error && runs.length === 0 && (
            <p className="px-2 py-10 text-center text-sm text-white/35">
              {query ? 'No runs match that search.' : 'Your finished runs will collect here.'}
            </p>
          )}

          <AnimatePresence initial={false}>
            {runs.map((run) => (
              <motion.div
                key={run.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="group mb-1.5 rounded-xl border border-white/8 bg-white/[0.03] p-3 transition-colors hover:border-emerald-400/30 hover:bg-white/[0.06]"
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => void open(run.id)}
                    className="min-w-0 flex-1 text-left"
                    title="Open this run"
                  >
                    <div className="truncate text-sm font-medium text-white/90">{run.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/35">
                      <span className={`rounded-full px-1.5 py-0.5 ${STATUS_STYLE[run.status]}`}>{run.status}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {relativeTime(run.startedAt)}
                      </span>
                      <span>
                        {run.taskCount} step{run.taskCount === 1 ? '' : 's'}
                      </span>
                      {run.files.length > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {run.files.length}
                        </span>
                      )}
                    </div>
                  </button>

                  {openingId === run.id ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-emerald-300" />
                  ) : (
                    <div className="flex shrink-0 items-start gap-0.5">
                      <button
                        onClick={() => void share(run.id)}
                        disabled={sharingId === run.id}
                        aria-label={`Share ${run.title}`}
                        title={shares[run.id] ? 'Copy share link' : 'Create a share link'}
                        className={`rounded-lg p-1.5 transition-all hover:bg-emerald-500/15 hover:text-emerald-300 focus:opacity-100 group-hover:opacity-100 ${
                          shares[run.id] ? 'text-emerald-400/80 opacity-100' : 'text-white/20 opacity-0'
                        }`}
                      >
                        {copiedId === run.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Share2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => void remove(run.id)}
                        aria-label={`Delete ${run.title}`}
                        title="Delete"
                        className="rounded-lg p-1.5 text-white/20 opacity-0 transition-all hover:bg-rose-500/15 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {shares[run.id] && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-1.5 text-[11px]">
                    <Link2 className="h-3 w-3 shrink-0 text-emerald-400/80" />
                    <span className="truncate text-emerald-100/70" title={shares[run.id].url}>
                      {copiedId === run.id ? 'Link copied — anyone with it can read this run' : shares[run.id].url}
                    </span>
                    <button
                      onClick={() => void revoke(run.id)}
                      title="Revoke this link"
                      className="ml-auto shrink-0 text-white/35 transition-colors hover:text-rose-300"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.aside>
    </>
  )
}
