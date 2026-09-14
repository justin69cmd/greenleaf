import { useEffect, useState } from 'react'
import { FileText, Download, Eye, EyeOff } from 'lucide-react'
import { fetchFile } from '@/api'

// Files the specialists saved during a run. Charts and images get an inline
// preview — a chart the analyst just rendered is worth seeing without a
// round-trip through the downloads folder — everything else stays a chip.
//
// Files are private to the account, so both the preview and the download are
// fetched with the session token and handed to the browser as blob URLs.

const PREVIEWABLE = /\.(svg|png|jpe?g|gif|webp)$/i

async function saveFile(file: string, token: string) {
  const url = URL.createObjectURL(await fetchFile(file, token))
  const a = document.createElement('a')
  a.href = url
  a.download = file.split('/').pop() || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export default function ArtifactCard({ files, token }: { files: string[]; token: string }) {
  const [open, setOpen] = useState<string | null>(() => files.find((f) => PREVIEWABLE.test(f)) ?? null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setPreview(null)
    if (!open) return
    let url: string | null = null
    let cancelled = false
    fetchFile(open, token)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreview(url)
      })
      // A workspace file can disappear between runs; fail quietly back to the
      // download chip rather than showing a broken-image icon.
      .catch(() => !cancelled && setOpen(null))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [open, token])

  if (!files.length) return null

  const download = (f: string) => {
    setError('')
    saveFile(f, token).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      <div className="flex flex-wrap gap-2">
        {files.map((f) => {
          const canPreview = PREVIEWABLE.test(f)
          const showing = open === f
          return (
            <span
              key={f}
              className="flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[14rem] truncate">{f}</span>
              {canPreview && (
                <button
                  onClick={() => setOpen(showing ? null : f)}
                  aria-label={showing ? `Hide preview of ${f}` : `Preview ${f}`}
                  title={showing ? 'Hide preview' : 'Preview'}
                  className="rounded p-0.5 transition-colors hover:bg-emerald-400/20 hover:text-emerald-100"
                >
                  {showing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              )}
              <button
                onClick={() => download(f)}
                aria-label={`Download ${f}`}
                title="Download"
                className="rounded p-0.5 transition-colors hover:bg-emerald-400/20 hover:text-emerald-100"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </span>
          )
        })}
      </div>

      {error && <p className="text-xs text-red-300/90">{error}</p>}

      {open && preview && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 p-2">
          <img src={preview} alt={`Preview of ${open}`} className="mx-auto max-h-80 w-auto max-w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
