import { useState, type ReactNode } from 'react'
import { Copy, Check, Download } from 'lucide-react'

// Render inline **bold** segments within a line.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{part}</span>
  })
}

// Minimal, dependency-free Markdown renderer for the agent's summary.
function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: { lead?: string; text: string }[] } | null = null
  let key = 0

  const flushList = () => {
    if (!list) return
    const items = list.items
    if (list.type === 'ul') {
      blocks.push(
        <ul key={key++} className="space-y-1.5 my-2">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-white/80 text-sm leading-relaxed">
              <span className="text-amber-300 mt-0.5 shrink-0">•</span>
              <span>{renderInline(it.text)}</span>
            </li>
          ))}
        </ul>
      )
    } else {
      blocks.push(
        <ol key={key++} className="space-y-1.5 my-2">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2.5 text-white/80 text-sm leading-relaxed">
              <span className="text-amber-300 font-semibold mt-0.5 shrink-0 tabular-nums">
                {it.lead}.
              </span>
              <span>{renderInline(it.text)}</span>
            </li>
          ))}
        </ol>
      )
    }
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) {
      flushList()
      continue
    }
    // Skip stray Markdown code fences (```), which the model occasionally emits.
    if (/^```/.test(line.trim())) {
      flushList()
      continue
    }
    if (line.startsWith('### ')) {
      flushList()
      blocks.push(
        <h4 key={key++} className="text-white/90 text-sm font-semibold mt-2.5 mb-0.5">
          {renderInline(line.slice(4))}
        </h4>
      )
      continue
    }
    if (line.startsWith('# ')) {
      flushList()
      blocks.push(
        <h2 key={key++} className="text-white text-lg font-semibold mt-1 mb-1.5 leading-snug">
          {renderInline(line.slice(2))}
        </h2>
      )
      continue
    }
    if (line.startsWith('## ')) {
      flushList()
      blocks.push(
        <h3 key={key++} className="text-white/90 text-sm font-semibold uppercase tracking-wide mt-3 mb-1">
          {renderInline(line.slice(3))}
        </h3>
      )
      continue
    }

    const bullet = line.match(/^[-•*]\s+(.*)$/)
    if (bullet) {
      if (list?.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [] }
      }
      list.items.push({ text: bullet[1] })
      continue
    }

    const numbered = line.match(/^(\d+)\.\s+(.*)$/)
    if (numbered) {
      if (list?.type !== 'ol') {
        flushList()
        list = { type: 'ol', items: [] }
      }
      list.items.push({ lead: numbered[1], text: numbered[2] })
      continue
    }

    flushList()
    blocks.push(
      <p key={key++} className="text-white/80 text-sm leading-relaxed my-1.5">
        {renderInline(line)}
      </p>
    )
  }
  flushList()
  return blocks
}

export default function ResultView({ summary }: { summary: string }) {
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      flash('Copied to clipboard')
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  const download = () => {
    try {
      const blob = new Blob([summary], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'equilibrium-result.md'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      flash('Downloaded .md')
    } catch { /* ignore */ }
  }

  return (
    <div className="relative rounded-[14px] overflow-hidden">
      {toast && (
        <div className="absolute top-2 right-2 z-10 rounded-full bg-amber-500/90 px-3 py-1 text-[11px] font-medium text-black shadow-lg">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-xs font-medium text-white/70 uppercase tracking-wider">Result</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={download}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors"
          >
            <Download size={13} />
            Download
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="px-4 py-3 max-h-72 overflow-y-auto">
        {renderMarkdown(summary)}
      </div>
    </div>
  )
}
