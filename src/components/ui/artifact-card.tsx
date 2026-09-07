import { useState } from 'react'
import { FileText, Download, Eye, EyeOff } from 'lucide-react'
import { fileUrl } from '@/api'

// Files the specialists saved during a run. Charts and images get an inline
// preview — a chart the analyst just rendered is worth seeing without a
// round-trip through the downloads folder — everything else stays a chip.

const PREVIEWABLE = /\.(svg|png|jpe?g|gif|webp)$/i

export default function ArtifactCard({ files }: { files: string[] }) {
  const [open, setOpen] = useState<string | null>(() => files.find((f) => PREVIEWABLE.test(f)) ?? null)

  if (!files.length) return null

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
              <a
                href={fileUrl(f)}
                download
                aria-label={`Download ${f}`}
                title="Download"
                className="rounded p-0.5 transition-colors hover:bg-emerald-400/20 hover:text-emerald-100"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </span>
          )
        })}
      </div>

      {open && (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40 p-2">
          <img
            src={fileUrl(open)}
            alt={`Preview of ${open}`}
            className="mx-auto max-h-80 w-auto max-w-full rounded-lg"
            // A workspace file can disappear between runs; fail quietly back to
            // the download chip rather than showing a broken-image icon.
            onError={() => setOpen(null)}
          />
        </div>
      )}
    </div>
  )
}
