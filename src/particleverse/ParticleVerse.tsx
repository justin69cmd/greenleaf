import { useEffect, useRef, useState, useCallback } from 'react'
import { ParticleField, type FieldControls } from './ParticleField'
import { HandTracker, TrackerError } from './handTracking'
import { TEMPLATES, type TemplateId } from './templates'

type CamStatus = 'idle' | 'requesting' | 'on' | 'denied' | 'unsupported'

interface HudState {
  template: TemplateId
  /** Normalized 0..1 of whatever is currently driving expansion. */
  expansion: number
  swirl: number
  hue: number
  handPresent: boolean
  /** 0, 1 or 2 hands tracked. */
  hands: number
  fps: number
}

const INITIAL_HUD: HudState = {
  template: 'heart',
  expansion: 0.5,
  swirl: 1,
  hue: 0,
  handPresent: false,
  hands: 0,
  fps: 0,
}

export default function ParticleVerse({ onExit }: { onExit?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<ParticleField | null>(null)
  const trackerRef = useRef<HandTracker | null>(null)

  const [camStatus, setCamStatus] = useState<CamStatus>('idle')
  const [camError, setCamError] = useState<string>('')
  const [glError, setGlError] = useState<string>('')
  const [hud, setHud] = useState<HudState>(INITIAL_HUD)
  const [showHelp, setShowHelp] = useState(true)

  // Mouse fallback control (used when no hand is present).
  const mouse = useRef({ x: 0.5, y: 0.5, down: false })

  // Template index ref so the rAF loop and buttons stay in sync.
  const templateIdx = useRef(0)
  // Timestamp of the last template change; pauses ambient auto-cycling.
  const lastSwitch = useRef(0)

  const switchTemplate = useCallback((dir: number | TemplateId) => {
    const field = fieldRef.current
    if (!field) return
    lastSwitch.current = performance.now()
    if (typeof dir === 'string') {
      templateIdx.current = TEMPLATES.findIndex((t) => t.id === dir)
    } else {
      templateIdx.current =
        (templateIdx.current + dir + TEMPLATES.length) % TEMPLATES.length
    }
    field.setTemplate(TEMPLATES[templateIdx.current].id)
  }, [])

  // --- engine + render loop ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let field: ParticleField
    try {
      field = new ParticleField(canvas)
    } catch (err) {
      // Most common cause: WebGL/hardware acceleration disabled in the browser.
      console.error('[ParticleVerse] WebGL init failed:', err)
      setGlError(
        "Couldn't start WebGL. Your browser has graphics acceleration disabled. " +
          'Enable it at chrome://settings/system → "Use graphics acceleration when ' +
          'available" → Relaunch, then reload this page.',
      )
      return
    }
    fieldRef.current = field

    const onResize = () => field.resize()
    window.addEventListener('resize', onResize)

    let raf = 0
    let alive = true
    let lastHud = 0
    let frames = 0
    let fpsClock = performance.now()
    let fps = 0
    // Demo auto-cycle when no hand is detected for a while.
    let idleTimer = 0
    // Previous two-hand twist angle, for frame-to-frame orbit delta.
    let prevSpanAngle: number | null = null

    const onMouseMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX / window.innerWidth
      mouse.current.y = e.clientY / window.innerHeight
    }
    const onMouseDown = () => (mouse.current.down = true)
    const onMouseUp = () => (mouse.current.down = false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)

    const loop = () => {
      if (!alive) return
      raf = requestAnimationFrame(loop)

      const tracker = trackerRef.current
      const g = tracker?.state
      const now = performance.now()
      const dtMs = now - (loop as any)._last || 16
      ;(loop as any)._last = now

      let ctrl: FieldControls
      let hue = 0
      if (g && g.present) {
        idleTimer = 0
        hue = g.y // hand HEIGHT → color (top = one hue, bottom = another)

        if (g.hands >= 2) {
          // --- Two-hand mode: span = expansion, twist = orbit ---
          // Pull hands apart to blow the shape up; bring together to collapse.
          const expansion = 0.45 + g.span * 2.3
          // Frame-to-frame twist of the line between hands rotates the field.
          let orbitDelta = 0
          if (prevSpanAngle !== null) {
            let d = g.spanAngle - prevSpanAngle
            // Unwrap to [-π, π] so crossing the seam doesn't spin wildly.
            if (d > Math.PI) d -= Math.PI * 2
            if (d < -Math.PI) d += Math.PI * 2
            // Ignore tiny jitter; scale the rest into a satisfying spin.
            orbitDelta = Math.abs(d) > 0.004 ? d * 1.6 : 0
          }
          prevSpanAngle = g.spanAngle
          ctrl = {
            expansion,
            hue: g.y,
            swirl: 0.15,
            burst: g.palmPop,
            burstX: g.x * 2 - 1,
            burstY: -(g.y * 2 - 1),
            active: true,
            orbitDelta,
          }
        } else {
          // --- One-hand mode: pinch = expansion, swipe = switch ---
          prevSpanAngle = null
          ctrl = {
            expansion: 0.5 + g.pinch * 1.7,
            hue: g.y,
            swirl: g.openness,
            burst: g.palmPop,
            burstX: g.x * 2 - 1,
            burstY: -(g.y * 2 - 1),
            active: true,
          }
          if (g.swipe !== 0) switchTemplate(g.swipe > 0 ? 1 : -1)
        }
      } else {
        prevSpanAngle = null
        // Mouse / idle fallback.
        idleTimer += dtMs
        const mx = mouse.current.x
        const my = mouse.current.y
        ctrl = {
          expansion: 0.7 + (1 - my) * 1.3,
          hue: 1 - my,
          swirl: mouse.current.down ? 0.8 : 0.12,
          burst: mouse.current.down,
          burstX: mx * 2 - 1,
          burstY: -(my * 2 - 1),
          active: false,
        }
        hue = 1 - my
        // Ambient auto-cycle: only when idle AND no recent manual selection,
        // so clicking a template doesn't get yanked away.
        if (idleTimer > 9000 && now - lastSwitch.current > 12000) {
          idleTimer = 0
          switchTemplate(1)
        }
      }

      field.update(ctrl)

      // FPS + HUD throttled to ~6Hz.
      frames++
      if (now - fpsClock > 500) {
        fps = Math.round((frames * 1000) / (now - fpsClock))
        frames = 0
        fpsClock = now
      }
      if (now - lastHud > 160) {
        lastHud = now
        const twoHand = !!g?.present && g.hands >= 2
        setHud({
          template: TEMPLATES[templateIdx.current].id,
          // Show the active expansion driver: span (two hands) or pinch (one).
          expansion: g?.present ? (twoHand ? g.span : g.pinch) : 0,
          swirl: g?.present ? (twoHand ? 0.15 : g.openness) : 0,
          hue,
          handPresent: !!g?.present,
          hands: g?.present ? g.hands : 0,
          fps,
        })
      }
    }
    loop()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      field.dispose()
      fieldRef.current = null
    }
  }, [switchTemplate])

  // --- camera toggle ---
  const enableCamera = useCallback(async () => {
    if (camStatus === 'on' || camStatus === 'requesting') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamStatus('unsupported')
      return
    }
    setCamStatus('requesting')
    setCamError('')
    try {
      const tracker = new HandTracker()
      await tracker.start()
      trackerRef.current = tracker
      // Mount the small webcam preview.
      const v = tracker.videoEl
      v.style.width = '100%'
      v.style.height = '100%'
      v.style.objectFit = 'cover'
      v.style.transform = 'scaleX(-1)' // mirror
      previewRef.current?.replaceChildren(v)
      setCamStatus('on')
      setShowHelp(false)
    } catch (err) {
      console.warn('[ParticleVerse] camera/hand-tracking failed:', err)
      const msg =
        err instanceof TrackerError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown error starting the camera.'
      setCamError(msg)
      setCamStatus(err instanceof TrackerError && err.kind === 'unsupported' ? 'unsupported' : 'denied')
    }
  }, [camStatus])

  useEffect(() => {
    return () => trackerRef.current?.stop()
  }, [])

  const hueDeg = Math.round(hud.hue * 360)

  return (
    <div className="fixed inset-0 z-50 bg-[#05060d] text-white overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* WebGL unavailable — friendly fallback instead of a blank screen */}
      {glError && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl p-6 text-center shadow-2xl">
            <div className="text-3xl mb-2">🎛️</div>
            <h2 className="text-xl font-semibold mb-2">Graphics acceleration is off</h2>
            <p className="text-sm text-white/70 leading-relaxed mb-4">{glError}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => location.reload()}
                className="rounded-full bg-fuchsia-500 hover:bg-fuchsia-400 px-5 py-2 text-sm font-medium transition"
              >
                Reload
              </button>
              {onExit && (
                <button
                  onClick={onExit}
                  className="rounded-full border border-white/15 px-5 py-2 text-sm hover:bg-white/10 transition"
                >
                  Agent app
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 sm:p-6 pointer-events-none">
        <div className="pointer-events-auto">
          <h1 className="text-lg sm:text-2xl font-semibold tracking-tight">
            Particle<span className="text-fuchsia-400">Verse</span>
          </h1>
          <p className="text-[11px] sm:text-xs text-white/50">
            gesture-driven 3D particle field
          </p>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {onExit && (
            <button
              onClick={onExit}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 transition"
            >
              ← Agent app
            </button>
          )}
        </div>
      </div>

      {/* Live stat readouts (top-left under title) */}
      <div className="absolute left-4 sm:left-6 top-20 sm:top-24 flex flex-col gap-2 text-xs">
        <Stat label="Shape" value={hud.template} accent />
        <Stat label="Expansion" bar={hud.expansion} />
        <Stat label="Swirl" bar={hud.swirl} />
        <Stat
          label="Hue"
          value={`${hueDeg}°`}
          swatch={`hsl(${hueDeg} 85% 60%)`}
        />
        <Stat label="FPS" value={String(hud.fps)} />
        <Stat
          label="Hands"
          value={
            hud.hands >= 2
              ? '2 · span+twist'
              : hud.handPresent
                ? '1 · tracking'
                : camStatus === 'on'
                  ? 'searching…'
                  : 'mouse'
          }
          dot={
            hud.hands >= 2
              ? '#a78bfa'
              : hud.handPresent
                ? '#34d399'
                : camStatus === 'on'
                  ? '#fbbf24'
                  : '#64748b'
          }
        />
      </div>

      {/* Webcam preview */}
      {camStatus === 'on' && (
        <div className="absolute right-4 sm:right-6 top-20 sm:top-24 w-32 sm:w-44 aspect-[4/3] rounded-xl overflow-hidden border border-white/15 shadow-lg shadow-black/50">
          <div ref={previewRef} className="h-full w-full" />
          <div className="absolute bottom-1 left-1.5 text-[10px] text-white/70 bg-black/40 px-1 rounded">
            you
          </div>
        </div>
      )}

      {/* Template selector */}
      <div className="absolute bottom-4 sm:bottom-6 inset-x-0 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-1.5 max-w-full overflow-x-auto">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTemplate(t.id)}
              className={`rounded-xl px-3 py-1.5 text-xs whitespace-nowrap transition ${
                hud.template === t.id
                  ? 'bg-fuchsia-500/90 text-white'
                  : 'text-white/70 hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Camera CTA / help overlay — always dismissable via "Use mouse" */}
      {showHelp && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full rounded-2xl border border-white/10 bg-black/55 backdrop-blur-xl p-6 text-center shadow-2xl">
            <h2 className="text-xl font-semibold mb-1">Control it with your hands</h2>
            <p className="text-sm text-white/60 mb-4">
              Allow camera access to drive the field with gestures. No video
              leaves your machine — tracking runs entirely in the browser.
            </p>
            <ul className="text-left text-sm text-white/70 space-y-1.5 mb-5">
              <li>🤏 <b>Pinch / spread</b> — contract & expand the cloud</li>
              <li>🙌 <b>Two hands apart / together</b> — blow up & collapse</li>
              <li>🔄 <b>Twist both hands</b> — orbit / spin the shape</li>
              <li>🖐 <b>Open palm</b> — burst / launch fireworks</li>
              <li>👉 <b>Swipe left / right</b> — switch templates</li>
              <li>↕️ <b>Raise / lower hand</b> — shift the color</li>
            </ul>
            {(camStatus === 'denied' || camStatus === 'unsupported') && (
              <p className="text-xs text-amber-300/90 mb-3 leading-relaxed">
                {camError ||
                  'Camera unavailable — you can still play with the mouse.'}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={enableCamera}
                disabled={camStatus === 'requesting'}
                className="rounded-full bg-fuchsia-500 hover:bg-fuchsia-400 px-5 py-2 text-sm font-medium transition disabled:opacity-60"
              >
                {camStatus === 'requesting' ? 'Starting…' : 'Enable camera'}
              </button>
              <button
                onClick={() => setShowHelp(false)}
                className="rounded-full border border-white/15 px-5 py-2 text-sm hover:bg-white/10 transition"
              >
                Use mouse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent tiny help toggle */}
      {!showHelp && (
        <button
          onClick={() => setShowHelp(true)}
          className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 rounded-full border border-white/15 bg-black/40 backdrop-blur px-3 py-1.5 text-xs hover:bg-white/10 transition"
        >
          ? help
        </button>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  bar,
  accent,
  swatch,
  dot,
}: {
  label: string
  value?: string
  bar?: number
  accent?: boolean
  swatch?: string
  dot?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-white/40">{label}</span>
      {bar !== undefined ? (
        <div className="h-1.5 w-24 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-fuchsia-400 transition-[width] duration-150"
            style={{ width: `${Math.round(bar * 100)}%` }}
          />
        </div>
      ) : (
        <span
          className={`flex items-center gap-1.5 font-medium ${
            accent ? 'text-fuchsia-300 capitalize' : 'text-white/80'
          }`}
        >
          {dot && (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: dot }}
            />
          )}
          {swatch && (
            <span
              className="inline-block h-3 w-3 rounded-sm border border-white/20"
              style={{ background: swatch }}
            />
          )}
          {value}
        </span>
      )}
    </div>
  )
}
