import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Loader2, Search, Trash2, Upload, X } from 'lucide-react'
import {
  deleteDocument,
  fetchDocuments,
  searchDocuments,
  uploadDocument,
  type Passage,
  type UserDocument,
} from '@/api'

const ACCEPT = '.pdf,.txt,.md,.csv,.json'

export default function DocumentsPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [docs, setDocs] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Passage[] | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      setDocs(await fetchDocuments(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your documents.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    setNote('')
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`)
      try {
        const result = await uploadDocument(token, file)
        if (result.note) setNote(result.note)
      } catch (err) {
        setError(err instanceof Error ? err.message : `Could not read ${file.name}.`)
      }
    }
    setBusy('')
    await load()
  }

  const search = async () => {
    if (!query.trim()) return setHits(null)
    setBusy('Searching…')
    try {
      setHits(await searchDocuments(token, query))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setBusy('')
    }
  }

  const size = (chars: number) =>
    chars > 1000 ? `${Math.round(chars / 1000)}k chars` : `${chars} chars`

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
          <FileText className="h-5 w-5 text-emerald-400" />
          Your documents
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Upload a syllabus, notes or a reading list and plans are built from what's actually in
          them.
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void upload(e.dataTransfer.files)
          }}
          onClick={() => fileRef.current?.click()}
          className="mt-4 cursor-pointer rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-5 text-center transition-colors hover:border-emerald-400/40"
        >
          <Upload className="mx-auto h-5 w-5 text-emerald-400/70" />
          <p className="mt-1.5 text-sm text-neutral-300">Drop a file, or click to choose</p>
          <p className="mt-0.5 text-[11px] text-neutral-600">PDF, Markdown, text, CSV — up to 8MB</p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>

        {docs.length > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="Ask your documents something…"
              className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none"
            />
          </div>
        )}

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {hits && (
            <div className="mb-3 space-y-2">
              <p className="text-xs uppercase tracking-widest text-neutral-500">
                {hits.length} matching passage{hits.length === 1 ? '' : 's'}
              </p>
              {hits.map((h) => (
                <div
                  key={`${h.docId}-${h.ordinal}`}
                  className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-3.5 py-2.5"
                >
                  <p className="text-[11px] text-sky-300/80">
                    {h.docName} · passage {h.ordinal + 1} · {Math.round(h.score * 100)}% match
                  </p>
                  <p className="mt-1 line-clamp-4 text-xs text-neutral-300">{h.text}</p>
                </div>
              ))}
              {hits.length === 0 && (
                <p className="text-sm text-neutral-500">Nothing in your documents matches that.</p>
              )}
            </div>
          )}

          <AnimatePresence initial={false}>
            {docs.map((d) => (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="group flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{d.name}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {size(d.chars)} · {d.chunks} passage{d.chunks === 1 ? '' : 's'} ·{' '}
                    {d.indexedAs === 'embedded' ? (
                      <span className="text-emerald-400/70">searched by meaning</span>
                    ) : (
                      <span className="text-amber-300/70">keyword search only</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() =>
                    void deleteDocument(token, d.id)
                      .then(load)
                      .catch(() => setError('Could not delete that.'))
                  }
                  aria-label={`Delete ${d.name}`}
                  className="shrink-0 rounded-lg p-1.5 text-white/20 opacity-0 transition-all hover:bg-rose-500/15 hover:text-rose-300 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {!loading && docs.length === 0 && !hits && (
            <p className="py-6 text-center text-sm text-neutral-500">Nothing uploaded yet.</p>
          )}
        </div>

        {busy && (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}
          </p>
        )}
        {note && <p className="mt-2 text-xs text-amber-300/80">{note}</p>}
        {error && <p className="mt-2 text-sm text-red-400/90">{error}</p>}
      </div>
    </div>
  )
}
