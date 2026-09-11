import { useEffect, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { fetchSharedRun, postSharedComment, type SharedRun } from '@/api'

// The read-only page behind a share link. No session is involved — whoever
// holds the link sees this one run, and nothing else about the account.
export default function SharedRunView({
  shareToken,
  sessionToken,
  viewerName,
  onClose,
}: {
  shareToken: string
  /** Present when the viewer happens to be signed in — their comment is then verified. */
  sessionToken?: string
  viewerName?: string
  onClose: () => void
}) {
  const [run, setRun] = useState<SharedRun | null>(null)
  const [error, setError] = useState('')
  const [author, setAuthor] = useState(viewerName ?? '')
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    fetchSharedRun(shareToken)
      .then(setRun)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [shareToken])

  const comment = async () => {
    if (!body.trim() || posting) return
    setPosting(true)
    setError('')
    try {
      const added = await postSharedComment(shareToken, body, author, sessionToken)
      setRun((prev) => (prev ? { ...prev, comments: [...prev.comments, added] } : prev))
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="fixed inset-0 z-[11000] overflow-y-auto bg-neutral-950">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-emerald-400/70">Shared plan</p>
            <h1 className="font-classy text-3xl italic text-white">{run?.title ?? 'Loading…'}</h1>
            {run && <p className="mt-1 text-xs text-neutral-500">Finished {when(run.finishedAt)}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-white/10 p-2 text-white/40 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && !run && (
          <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {run && (
          <>
            <p className="mb-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">
              <span className="text-neutral-500">Goal: </span>
              {run.goal}
            </p>

            <article className="whitespace-pre-wrap rounded-2xl border border-emerald-400/20 bg-neutral-900/60 px-5 py-4 text-sm leading-relaxed text-neutral-100">
              {run.summary}
            </article>

            {run.tasks.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">
                  How it was built
                </h2>
                <ol className="space-y-1.5">
                  {run.tasks.map((t) => (
                    <li key={t.id} className="flex gap-2.5 text-sm text-neutral-400">
                      <span className={t.status === 'done' ? 'text-emerald-400' : 'text-neutral-600'}>
                        {t.status === 'done' ? '✓' : '•'}
                      </span>
                      <span>
                        {t.description}
                        {t.role && <span className="ml-1.5 text-[11px] text-neutral-600">{t.role}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="mt-8 border-t border-white/10 pt-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                <MessageCircle className="h-4 w-4 text-emerald-400" />
                Comments {run.comments.length > 0 && <span className="text-neutral-500">({run.comments.length})</span>}
              </h2>

              <div className="space-y-3">
                {run.comments.map((c) => (
                  <div key={c.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
                    <p className="text-xs text-neutral-400">
                      <span className="text-neutral-200">{c.author}</span>
                      {c.verified && <span className="ml-1.5 text-emerald-400/80">✓ signed in</span>}
                      <span className="ml-2 text-neutral-600">{when(c.at)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-200">{c.body}</p>
                  </div>
                ))}
                {run.comments.length === 0 && (
                  <p className="text-sm text-neutral-500">No comments yet.</p>
                )}
              </div>

              {run.allowComments ? (
                <div className="mt-4 space-y-2">
                  {!sessionToken && (
                    <input
                      type="text"
                      placeholder="Your name"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-emerald-400/60"
                    />
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add a comment…"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && comment()}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-emerald-400/60"
                    />
                    <button
                      onClick={comment}
                      disabled={posting || !body.trim() || (!sessionToken && !author.trim())}
                      className="rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-4 text-sm text-emerald-50 transition-colors hover:bg-emerald-400/25 disabled:opacity-40"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  {error && <p className="text-sm text-red-400/90">{error}</p>}
                </div>
              ) : (
                <p className="mt-4 text-xs text-neutral-600">Comments are turned off for this run.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
