import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { X, Paperclip, ArrowUp, Mic, RotateCcw, Copy, Check, History, Square, Brain, CalendarPlus, FileText } from 'lucide-react'
import SwarmGraph, { type SwarmTask } from '@/components/ui/swarm-graph'
import UsageMeter, { type Usage } from '@/components/ui/usage-meter'
import ArtifactCard from '@/components/ui/artifact-card'
import CalendarSheet from '@/components/ui/calendar-sheet'
import RunHistory from '@/components/ui/run-history'
import { WS_URL, type RunDetail } from '@/api'

const CHIPS = ['Plan my week', 'Set a goal', 'Daily routine', 'Brain dump']
const FOLLOWUP_CHIPS = ['Refine this plan', 'Make it shorter', 'What should I do first?']
const CHAT_KEY = 'greenleaf-chat'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  files?: string[]
}

function loadChat(): Msg[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Web Speech API (Chrome/Edge; absent elsewhere — the mic button hides itself).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
const SpeechRec: (new () => SpeechRecognitionLike) | undefined =
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition ??
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition

const EMPTY_USAGE: Usage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
  byModel: {},
  elapsedMs: 0,
}

/** A past run the swarm recalled as relevant to the current goal. */
interface Recalled {
  runId: string
  title: string
}

/** Session token for the signed-in account — scopes run history and memory. */
function loadToken(): string {
  try {
    return (JSON.parse(localStorage.getItem('greenleaf-user') || 'null')?.token as string) || ''
  } catch {
    return ''
  }
}

interface LeafParticle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  size: number
  sway: number
  swaySpeed: number
  sprite: number
  depth: number
}

// Pre-render a leaf into an offscreen canvas (blade gradient + midrib + veins).
function makeLeafSprite(c1: string, c2: string, c3: string): HTMLCanvasElement {
  const S = 64
  const cnv = document.createElement('canvas')
  cnv.width = S
  cnv.height = S
  const g = cnv.getContext('2d')!
  g.translate(S / 2, S / 2)

  const grad = g.createLinearGradient(-12, -26, 12, 26)
  grad.addColorStop(0, c1)
  grad.addColorStop(0.5, c2)
  grad.addColorStop(1, c3)
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, -26)
  g.bezierCurveTo(-14, -14, -16, 12, 0, 26)
  g.bezierCurveTo(16, 12, 14, -14, 0, -26)
  g.closePath()
  g.fill()

  g.strokeStyle = 'rgba(220,252,231,0.45)'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, 24)
  g.lineTo(0, -24)
  g.stroke()

  g.lineWidth = 0.8
  g.beginPath()
  g.moveTo(0, 8)
  g.lineTo(-8, 0)
  g.moveTo(0, 8)
  g.lineTo(8, 0)
  g.moveTo(0, -2)
  g.lineTo(-7, -9)
  g.moveTo(0, -2)
  g.lineTo(7, -9)
  g.stroke()

  return cnv
}

/* ── Tiny markdown renderer for the synthesizer's output ──────────────────────
   The backend emits the same Markdown subset that ResultView/pdf render:
   headings (#–####), bullet & numbered lists, **bold**, and paragraphs. */
function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {p.slice(2, -2)}
        </strong>
      )
    }
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
      return (
        <code key={i} className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] text-emerald-200">
          {p.slice(1, -1)}
        </code>
      )
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return (
        <em key={i} className="text-emerald-100/90">
          {p.slice(1, -1)}
        </em>
      )
    }
    return <span key={i}>{p}</span>
  })
}

function renderRich(text: string): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []
  let ordered = false
  // Running number for ordered lists — survives blank lines and interleaved
  // sub-bullets so "1./2./3." doesn't reset to "1." at every gap.
  let olStart = 1

  const flush = () => {
    if (!list.length) return
    const items = list.map((it, i) => <li key={i}>{inline(it)}</li>)
    if (ordered) {
      blocks.push(
        <ol key={`b${blocks.length}`} start={olStart} className="ml-5 list-decimal space-y-1">
          {items}
        </ol>
      )
      olStart += list.length
    } else {
      blocks.push(
        <ul key={`b${blocks.length}`} className="ml-5 list-disc space-y-1">
          {items}
        </ul>
      )
    }
    list = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    // Blank lines don't flush — lists commonly have gaps between items.
    if (!line) continue
    // Horizontal rules render as a subtle divider, not literal dashes.
    if (/^[-*_]{3,}$/.test(line)) {
      flush()
      olStart = 1
      blocks.push(<div key={`b${blocks.length}`} className="my-1 border-t border-white/10" />)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      olStart = 1
      const big = h[1].length <= 2
      blocks.push(
        <p
          key={`b${blocks.length}`}
          className={
            big
              ? 'mt-3 text-base font-semibold text-emerald-100'
              : 'mt-2 text-sm font-semibold text-emerald-100/90'
          }
        >
          {inline(h[2])}
        </p>
      )
      continue
    }
    const ul = line.match(/^[-*+]\s+(.*)$/)
    const ol = line.match(/^\d+[.)]\s+(.*)$/)
    if (ul) {
      if (ordered) flush()
      ordered = false
      list.push(ul[1])
      continue
    }
    if (ol) {
      if (!ordered && list.length) flush()
      ordered = true
      list.push(ol[1])
      continue
    }
    flush()
    olStart = 1
    blocks.push(<p key={`b${blocks.length}`}>{inline(line)}</p>)
  }
  flush()
  return blocks
}

export default function AIModelView({
  onClose,
  userName,
}: {
  onClose: () => void
  userName?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const firstName = userName?.trim().split(' ')[0]

  // ── Chat state (persisted so a refresh doesn't wipe the conversation) ───────
  const [messages, setMessages] = useState<Msg[]>(loadChat)
  const [started, setStarted] = useState(() => loadChat().length > 0)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [tasks, setTasks] = useState<SwarmTask[]>([])
  const [listening, setListening] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE)
  const [recalled, setRecalled] = useState<Recalled[]>([])
  // Passages from the user's own uploads that this run is drawing on.
  const [sources, setSources] = useState<{ name: string; score: number }[]>([])
  // The answer as it is being written, shown live and then replaced by the
  // finished message when agent_done lands.
  const [draft, setDraft] = useState('')
  // The answer being turned into calendar events, if any.
  const [calendarFor, setCalendarFor] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [token] = useState(loadToken)

  const copyMessage = (i: number, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1500)
    })
  }

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)))
  }, [messages])

  const wsRef = useRef<WebSocket | null>(null)
  const convoStartedRef = useRef(false) // false → next dispatch is `start`, else `followup`
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Files the writer agent saved during the current run (from tool_result events).
  const filesRef = useRef<string[]>([])
  // Mirrors `busy` for event handlers (onclose fires outside the render cycle).
  const busyRef = useRef(false)
  // Set once a run is cancelled. Work already in flight on the server (a plan
  // still being drafted, a step mid-tool-call) can emit a few more events
  // after the `cancelled` reply; without this they would repopulate a panel
  // the user just dismissed.
  const cancelledRef = useRef(false)
  const setBusySync = (v: boolean) => {
    busyRef.current = v
    setBusy(v)
  }

  const pushAssistant = (text: string, files?: string[]) =>
    setMessages((m) => [...m, { role: 'assistant', text, ...(files?.length ? { files } : {}) }])

  const newChat = () => {
    wsRef.current?.close()
    wsRef.current = null
    convoStartedRef.current = false
    localStorage.removeItem(CHAT_KEY)
    setMessages([])
    setTasks([])
    setStatus('')
    setUsage(EMPTY_USAGE)
    setRecalled([])
    setStopping(false)
    cancelledRef.current = false
    setBusySync(false)
    setStarted(false)
  }

  // Ask the server to stand the team down. It aborts between steps and replies
  // with `cancelled`, so the UI stays in "stopping" until the swarm is actually
  // idle rather than pretending the work stopped instantly.
  const stopRun = () => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    setStopping(true)
    setStatus('Stopping the team…')
    ws.send(JSON.stringify({ type: 'cancel' }))
  }

  // Reopen a past run as the newest answer in the thread.
  const openRun = (run: RunDetail) => {
    setShowHistory(false)
    setStarted(true)
    setMessages((m) => [
      ...m,
      { role: 'user', text: run.title },
      { role: 'assistant', text: run.summary, ...(run.files?.length ? { files: run.files } : {}) },
    ])
  }

  const toggleVoice = () => {
    if (!SpeechRec) return
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = new SpeechRec()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('')
      setInput(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  // Auto-scroll the thread as it grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, status, busy])

  // Close the socket when the view unmounts.
  useEffect(() => () => wsRef.current?.close(), [])

  const send = (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return

    setMessages((m) => [...m, { role: 'user', text }])
    setStarted(true)
    setInput('')
    setBusySync(true)
    setTasks([])
    setUsage(EMPTY_USAGE)
    setRecalled([])
    setStopping(false)
    cancelledRef.current = false
    filesRef.current = []
    setStatus('Connecting…')

    const dispatch = () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (!convoStartedRef.current) {
        convoStartedRef.current = true
        ws.send(JSON.stringify({ type: 'start', goal: text, delivery: 'screen', skipClarify: true, token }))
      } else {
        ws.send(JSON.stringify({ type: 'followup', goal: text }))
      }
    }

    const onMessage = (ev: MessageEvent) => {
      let msg: { type: string; payload: unknown }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      const ws = wsRef.current
      // After a cancel, only the server's own acknowledgement still matters.
      if (cancelledRef.current && msg.type !== 'cancelled') return
      switch (msg.type) {
        case 'log':
          setStatus(String(msg.payload))
          break
        case 'clarify':
          // Keep the chat single-shot — skip clarifying questions and plan.
          setStatus('Planning your steps…')
          ws?.send(JSON.stringify({ type: 'clarify', answers: [] }))
          break
        case 'plan_proposed':
          setStatus('Kicking off the plan…')
          ws?.send(JSON.stringify({ type: 'approve' }))
          break
        case 'plan': {
          const plan = (msg.payload as SwarmTask[]) ?? []
          setTasks(plan.map((t) => ({ ...t, status: 'pending' })))
          setStatus('The team is on it…')
          break
        }
        case 'task_start': {
          const t = msg.payload as SwarmTask
          setTasks((prev) => prev.map((p) => (p.id === t.id ? { ...p, status: 'running' } : p)))
          break
        }
        case 'task_done': {
          // Merge the whole task back in — it carries the measured duration.
          const t = msg.payload as SwarmTask
          setTasks((prev) => prev.map((p) => (p.id === t.id ? { ...p, ...t, status: 'done' } : p)))
          break
        }
        case 'answer_start':
          // A new draft (the critic's revision reuses this) — clear the old one.
          setDraft('')
          setStatus('Writing the answer…')
          break
        case 'answer_delta':
          setDraft((prev) => prev + String(msg.payload ?? ''))
          break
        case 'usage':
          setUsage(msg.payload as Usage)
          break
        case 'memory':
          setRecalled((msg.payload as Recalled[]) ?? [])
          break
        case 'documents':
          setSources((msg.payload as { name: string; score: number }[]) ?? [])
          break
        case 'cancelled':
          cancelledRef.current = true
          pushAssistant('⏹ Stopped. Nothing further was run.')
          setDraft('')
          setStatus('')
          setTasks([])
          setStopping(false)
          setBusySync(false)
          break
        case 'tool_result': {
          // Collect files the writer saved so the answer can offer downloads.
          const p = msg.payload as { tool?: string; result?: string }
          const m = p?.result?.match(/agent_workspace\/([^\s)]+)/)
          if (m?.[1] && !filesRef.current.includes(m[1])) filesRef.current.push(m[1])
          break
        }
        case 'agent_done': {
          const p = msg.payload as { summary?: string; files?: string[]; usage?: Usage }
          // Prefer the server's file list — it sees every artifact, including
          // charts written by tools other than write_file.
          pushAssistant(p?.summary ?? 'Done.', p?.files?.length ? p.files : filesRef.current)
          if (p?.usage) setUsage(p.usage)
          setDraft('')
          setSources([])
          setStatus('')
          setTasks([])
          setStopping(false)
          setBusySync(false)
          window.dispatchEvent(new Event('leaf-burst'))
          break
        }
        case 'agent_error':
          pushAssistant(`⚠️ ${String(msg.payload)}`)
          setDraft('')
          setStatus('')
          setTasks([])
          setStopping(false)
          setBusySync(false)
          break
        default:
          break
      }
    }

    let ws = wsRef.current
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      ws = new WebSocket(WS_URL)
      wsRef.current = ws
      convoStartedRef.current = false
      ws.onmessage = onMessage
      ws.onopen = dispatch
      ws.onerror = () => {
        setStatus('')
        setTasks([])
        setStopping(false)
        setBusySync(false)
        pushAssistant('⚠️ Could not reach the planner. Make sure the server is running on port 4000.')
      }
      // If the connection drops mid-run, unfreeze the input so the user can
      // retry (a fresh socket + `start` is created on the next send).
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (busyRef.current) {
          setStatus('')
          setTasks([])
          setStopping(false)
          setBusySync(false)
          pushAssistant('⚠️ Lost connection to the planner. Check the server, then send your message again.')
        }
      }
    } else {
      ws.onmessage = onMessage
      if (ws.readyState === WebSocket.OPEN) dispatch()
      else ws.onopen = dispatch
    }
  }

  // ── Leaf swirl canvas ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    const mouse = { x: -9999, y: -9999, active: false }

    const sprites = [
      makeLeafSprite('#6ee7b7', '#10b981', '#047857'),
      makeLeafSprite('#a7f3d0', '#34d399', '#059669'),
      makeLeafSprite('#34d399', '#059669', '#065f46'),
    ]

    let leaves: LeafParticle[] = []

    // Celebration burst — a fan of leaves from the centre when an answer lands.
    interface BurstLeaf {
      x: number; y: number; vx: number; vy: number
      rot: number; vrot: number; size: number; sprite: number; life: number
    }
    let bursts: BurstLeaf[] = []
    const onBurst = () => {
      if (reduce) return
      const cx = w / 2
      const cy = h * 0.4
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 2.5 + Math.random() * 4.5
        bursts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1.2,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 0.3,
          size: 18 + Math.random() * 24,
          sprite: Math.floor(Math.random() * sprites.length),
          life: 1,
        })
      }
    }
    window.addEventListener('leaf-burst', onBurst)

    const seed = () => {
      const count = Math.round(Math.min(34, Math.max(16, (w * h) / 45000)))
      leaves = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.02,
        size: 24 + Math.random() * 30,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.008 + Math.random() * 0.02,
        sprite: Math.floor(Math.random() * sprites.length),
        depth: 0.5 + Math.random() * 0.5,
      }))
    }

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    const frame = () => {
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h * 0.45

      for (const l of leaves) {
        if (!reduce) {
          l.sway += l.swaySpeed
          // gentle swirl around the centre
          const sx = l.x - cx
          const sy = l.y - cy
          l.x += -sy * 0.0007 * l.depth
          l.y += sx * 0.0007 * l.depth
          // drift + breeze sway
          l.x += l.vx + Math.sin(l.sway) * 0.5
          l.y += l.vy + Math.cos(l.sway * 0.8) * 0.25 - 0.04
          l.rot += l.vrot + Math.sin(l.sway) * 0.006
          // cursor reaction — leaves get nudged away
          if (mouse.active) {
            const dx = l.x - mouse.x
            const dy = l.y - mouse.y
            const d2 = dx * dx + dy * dy
            const R = 170
            if (d2 < R * R) {
              const d = Math.sqrt(d2) || 1
              const f = ((R - d) / R) * 0.9
              l.x += (dx / d) * f
              l.y += (dy / d) * f
              l.rot += 0.01
            }
          }
          // wrap around edges
          if (l.x < -50) l.x = w + 50
          if (l.x > w + 50) l.x = -50
          if (l.y < -50) l.y = h + 50
          if (l.y > h + 50) l.y = -50
        }

        ctx.save()
        ctx.translate(l.x, l.y)
        ctx.rotate(l.rot)
        ctx.globalAlpha = 0.85
        ctx.drawImage(sprites[l.sprite], -l.size / 2, -l.size / 2, l.size, l.size)
        ctx.restore()
      }
      // Burst leaves: fly outward, drift down, fade out.
      for (const b of bursts) {
        b.x += b.vx
        b.y += b.vy
        b.vx *= 0.97
        b.vy = b.vy * 0.97 + 0.06
        b.rot += b.vrot
        b.life -= 0.011
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.globalAlpha = Math.max(0, b.life) * 0.9
        ctx.drawImage(sprites[b.sprite], -b.size / 2, -b.size / 2, b.size, b.size)
        ctx.restore()
      }
      bursts = bursts.filter((b) => b.life > 0)

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      mouse.x = e.clientX - r.left
      mouse.y = e.clientY - r.top
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = -9999
      mouse.y = -9999
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeave)
    frame()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('leaf-burst', onBurst)
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  // The chat input box, reused in both the hero and conversation layouts.
  const inputBox = (
    <div className="profile-card rounded-2xl bg-neutral-900/70 p-3 backdrop-blur-md">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        placeholder={busy ? 'Working…' : 'Ask GreenLeaf AI…'}
        className="w-full bg-transparent px-2 pb-6 pt-1 text-sm text-white placeholder-white/35 outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            aria-label="Attach"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:text-white/70"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          {SpeechRec && (
            <button
              onClick={toggleVoice}
              aria-label={listening ? 'Stop listening' : 'Speak your goal'}
              className={
                listening
                  ? 'mic-live flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/25 text-emerald-300'
                  : 'flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:text-emerald-300'
              }
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-[9500] overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 45%, #0c2018 0%, #05100b 55%, #020604 100%)' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="absolute left-5 top-5 z-20 flex items-center gap-2">
        {started && (
          <button
            onClick={newChat}
            aria-label="Start a new chat"
            title="New chat"
            className="flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-sm text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            New chat
          </button>
        )}
        {/* History lives server-side against the account, so it only exists
            for a signed-in user. */}
        {token && (
          <button
            onClick={() => setShowHistory(true)}
            aria-label="Open run history"
            title="Run history"
            className="flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 text-sm text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
          >
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">History</span>
          </button>
        )}
      </div>

      <AnimatePresence>
        {showHistory && token && (
          <RunHistory token={token} onOpen={openRun} onClose={() => setShowHistory(false)} />
        )}
      </AnimatePresence>

      {!started ? (
        /* ── Hero: centred prompt before the first message ── */
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
          <h2 className="ai-fade-up text-center text-3xl font-semibold text-emerald-50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] sm:text-4xl">
            {firstName ? (
              <>
                What can I help you plan,{' '}
                <span className="font-classy italic text-emerald-300">{firstName}</span>?
              </>
            ) : (
              'What can I help you plan?'
            )}
          </h2>

          <div className="ai-fade-up mt-7 w-full max-w-xl" style={{ animationDelay: '0.5s' }}>
            {inputBox}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => send(c)}
                  className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:border-emerald-400/40 hover:text-white"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── Conversation: thread + pinned input ── */
        <div className="relative z-10 flex h-full flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-20 pb-4">
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="self-end max-w-[85%]">
                    <div className="rounded-2xl rounded-br-md bg-emerald-500/90 px-4 py-2.5 text-sm text-black">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="answer-reveal group self-start max-w-[92%]">
                    <div className="profile-card relative space-y-2 rounded-2xl rounded-bl-md bg-neutral-900/75 px-4 py-3 text-sm leading-relaxed text-neutral-100 backdrop-blur-md">
                      <button
                        onClick={() => copyMessage(i, m.text)}
                        aria-label="Copy answer"
                        title="Copy answer"
                        className="absolute right-2.5 top-2.5 rounded-md p-1 text-white/25 opacity-0 transition-all hover:bg-white/10 hover:text-emerald-300 group-hover:opacity-100"
                      >
                        {copiedIdx === i ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {(renderRich(m.text) as ReactNode[]).map((block, bi) => (
                        <div
                          key={bi}
                          className="block-reveal"
                          style={{ animationDelay: `${Math.min(bi * 70, 900)}ms` }}
                        >
                          {block}
                        </div>
                      ))}
                      {m.files && m.files.length > 0 && <ArtifactCard files={m.files} />}

                      {/* Plans are only useful if they end up somewhere real. */}
                      {loadToken() && !m.text.startsWith('⚠️') && !m.text.startsWith('⏹') && (
                        <button
                          onClick={() => setCalendarFor(m.text)}
                          className="mt-1 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-emerald-400/40 hover:text-white"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          Add to calendar
                        </button>
                      )}
                    </div>
                  </div>
                )
              )}

              {/* Contextual follow-ups once an answer is on screen */}
              {!busy && messages.length > 0 && messages[messages.length - 1].role === 'assistant' &&
                !messages[messages.length - 1].text.startsWith('⚠️') && (
                  <div className="answer-reveal flex flex-wrap gap-2 self-start" style={{ animationDelay: '0.9s' }}>
                    {FOLLOWUP_CHIPS.map((c) => (
                      <button
                        key={c}
                        onClick={() => send(c)}
                        className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/60 transition-colors hover:border-emerald-400/40 hover:text-white"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}

              {busy && (
                <div className="answer-reveal self-start w-full max-w-[92%]">
                  <div className="rounded-2xl rounded-bl-md border border-emerald-400/25 bg-neutral-900/65 px-4 py-3 backdrop-blur-md">
                    {recalled.length > 0 && (
                      <div
                        className="mb-3 flex items-start gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.07] px-2.5 py-2 text-[12px] text-sky-200/80"
                        title={recalled.map((r) => r.title).join('\n')}
                      >
                        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Building on {recalled.length} earlier run{recalled.length === 1 ? '' : 's'}:{' '}
                          <span className="text-sky-100/90">{recalled.map((r) => r.title).join(' · ')}</span>
                        </span>
                      </div>
                    )}

                    {sources.length > 0 && (
                      <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-2 text-[12px] text-emerald-200/80">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Reading your{' '}
                          <span className="text-emerald-100/90">
                            {Array.from(new Set(sources.map((s) => s.name))).join(' · ')}
                          </span>
                        </span>
                      </div>
                    )}

                    {tasks.length > 0 && (
                      <div className="mb-3 border-b border-white/5 pb-3">
                        <SwarmGraph tasks={tasks} />
                      </div>
                    )}

                    {draft && (
                      <div className="mb-3 space-y-2 border-b border-white/5 pb-3 text-sm leading-relaxed text-neutral-100">
                        {(renderRich(draft) as ReactNode[]).map((block, bi) => (
                          <div key={bi}>{block}</div>
                        ))}
                        {/* Cursor, so a pause between tokens still reads as "working". */}
                        <span className="inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-emerald-400/80" />
                      </div>
                    )}

                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="leaf-pulse">🌿</span>
                      <span className="status-shimmer flex-1 font-medium">{status || 'Thinking…'}</span>
                      <button
                        onClick={stopRun}
                        disabled={stopping}
                        title="Stop this run"
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-40"
                      >
                        <Square className="h-3 w-3" fill="currentColor" />
                        {stopping ? 'Stopping…' : 'Stop'}
                      </button>
                    </div>

                    <UsageMeter usage={usage} className="mt-2.5 border-t border-white/5 pt-2.5" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pb-8">
            <div className="mx-auto w-full max-w-2xl">{inputBox}</div>
          </div>
        </div>
      )}
      {calendarFor && (
        <CalendarSheet
          token={loadToken()}
          text={calendarFor}
          onClose={() => setCalendarFor(null)}
        />
      )}
    </div>
  )
}
