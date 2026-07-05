import { useEffect, useRef } from 'react'

interface EquilibriumHeroBgProps {
  /** Positioning/sizing classes from the parent (the wrapper fills this box). */
  className?: string
  /** Star density multiplier. Default 1. */
  density?: number
}

interface Star {
  x: number
  y: number
  size: number
  bright: number // 0–1, power-law distributed
  tw: number
  ph: number
  cr: number // stellar color (temperature)
  cg: number
  cb: number
  spikes: boolean // only the brightest get diffraction spikes
}

interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  len: number
  life: number
  maxLife: number
}

interface Pulse {
  x: number
  y: number
  r: number
  life: number
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * EquilibriumHeroBg — a big, revolving, cursor-steered multicolor nebula.
 *
 * Procedural fractal-noise gas (purple core, red outer shells, teal filaments),
 * concentric multicolor shells, a glowing core, twinkling stars, shooting stars,
 * and click ripples. The whole nebula slowly revolves and is steered + parallaxed
 * by the cursor, which also lights up the surrounding gas. Pure Canvas 2D.
 */
export function EquilibriumHeroBg({ className = '', density = 1 }: EquilibriumHeroBgProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    let width = 0
    let height = 0
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false }
    let spin = 0
    let steer = 0
    let steerTarget = 0
    let pxOff = 0
    let pyOff = 0
    const meteors: Meteor[] = []
    const pulses: Pulse[] = []
    let meteorCountdown = 120

    // ── value-noise + fbm/ridged ─────────────────────────────────────────────
    const NSIZE = 96
    const rng = mulberry32(1337)
    const grid = new Float32Array(NSIZE * NSIZE)
    for (let i = 0; i < grid.length; i++) grid[i] = rng()
    const gridAt = (x: number, y: number) => {
      x = ((x % NSIZE) + NSIZE) % NSIZE
      y = ((y % NSIZE) + NSIZE) % NSIZE
      return grid[(y | 0) * NSIZE + (x | 0)]
    }
    const smooth = (t: number) => t * t * (3 - 2 * t)
    const noise = (fx: number, fy: number) => {
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = smooth(fx - x0)
      const ty = smooth(fy - y0)
      const a = gridAt(x0, y0) + (gridAt(x0 + 1, y0) - gridAt(x0, y0)) * tx
      const b = gridAt(x0, y0 + 1) + (gridAt(x0 + 1, y0 + 1) - gridAt(x0, y0 + 1)) * tx
      return a + (b - a) * ty
    }
    const fbm = (x: number, y: number, oct: number) => {
      let amp = 0.5
      let freq = 1
      let sum = 0
      let norm = 0
      for (let o = 0; o < oct; o++) {
        sum += amp * noise(x * freq, y * freq)
        norm += amp
        amp *= 0.5
        freq *= 2
      }
      return sum / norm
    }
    const ridged = (x: number, y: number, oct: number) => {
      let amp = 0.5
      let freq = 1
      let sum = 0
      let norm = 0
      for (let o = 0; o < oct; o++) {
        const n = 1 - Math.abs(noise(x * freq, y * freq) * 2 - 1)
        sum += amp * n * n
        norm += amp
        amp *= 0.5
        freq *= 2
      }
      return sum / norm
    }

    // Purple base ramp; red + teal are layered on per-pixel below.
    const STOPS: Array<[number, [number, number, number]]> = [
      [0.0, [12, 8, 28]],
      [0.22, [60, 24, 96]],
      [0.45, [136, 44, 186]],
      [0.65, [206, 64, 158]],
      [0.82, [240, 130, 200]],
      [1.0, [255, 244, 255]],
    ]
    const ramp = (d: number): [number, number, number] => {
      for (let i = 1; i < STOPS.length; i++) {
        if (d <= STOPS[i][0]) {
          const [t0, c0] = STOPS[i - 1]
          const [t1, c1] = STOPS[i]
          const f = (d - t0) / (t1 - t0 || 1)
          return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
        }
      }
      return STOPS[STOPS.length - 1][1]
    }

    // ── bake multicolor nebula gas into a texture (once) ──────────────────────
    function makeNebula(seedShift: number): HTMLCanvasElement {
      const T = 340
      const c = document.createElement('canvas')
      c.width = T
      c.height = T
      const g = c.getContext('2d')!
      const img = g.createImageData(T, T)
      const data = img.data
      const scale = 3.2
      for (let j = 0; j < T; j++) {
        for (let i = 0; i < T; i++) {
          const nx = (i / T) * scale + seedShift
          const ny = (j / T) * scale + seedShift * 0.7
          const fil = ridged(nx * 1.7 + 11, ny * 1.7 + 4, 4)
          let d = fbm(nx, ny, 5) * 0.65 + fil * 0.55
          const cx = i / T - 0.5
          const cy = j / T - 0.5
          const rr = Math.sqrt(cx * cx + cy * cy) * 2
          d *= Math.max(0, 1 - rr * 0.95)
          d = Math.max(0, Math.min(1, (d - 0.26) * 2))
          const idx = (j * T + i) * 4
          if (d <= 0.002) {
            data[idx + 3] = 0
            continue
          }
          const col = ramp(d)
          let R = col[0]
          let G = col[1]
          let B = col[2]
          // Red outer shell band (where gas exists in the mid-outer radius)
          const shell = Math.exp(-((rr - 0.6) * (rr - 0.6)) / (2 * 0.14 * 0.14))
          R = Math.min(255, R + 150 * shell)
          G = Math.min(255, G + 26 * shell)
          // Teal / green filaments
          const fk = Math.max(0, fil - 0.55) * 2.2
          G = Math.min(255, G + 80 * fk)
          B = Math.min(255, B + 45 * fk)
          data[idx] = R
          data[idx + 1] = G
          data[idx + 2] = B
          data[idx + 3] = Math.min(255, d * 255)
        }
      }
      g.putImageData(img, 0, 0)
      return c
    }

    const neb1 = makeNebula(0)
    const neb2 = makeNebula(17.3)

    // Soft white bloom sprite (drawn under each star) + stellar color ramp.
    const SG = 64
    const starGlow = document.createElement('canvas')
    starGlow.width = SG
    starGlow.height = SG
    const sgctx = starGlow.getContext('2d')!
    const sgr = sgctx.createRadialGradient(SG / 2, SG / 2, 0, SG / 2, SG / 2, SG / 2)
    sgr.addColorStop(0, 'rgba(255,255,255,0.9)')
    sgr.addColorStop(0.25, 'rgba(255,255,255,0.3)')
    sgr.addColorStop(1, 'rgba(255,255,255,0)')
    sgctx.fillStyle = sgr
    sgctx.fillRect(0, 0, SG, SG)

    // Star color by temperature: blue-white → white → yellow → amber → orange.
    const STAR_STOPS: Array<[number, [number, number, number]]> = [
      [0, [170, 196, 255]],
      [0.25, [214, 226, 255]],
      [0.5, [255, 255, 248]],
      [0.7, [255, 241, 205]],
      [0.86, [255, 216, 150]],
      [1, [255, 184, 128]],
    ]
    const starColor = (temp: number): [number, number, number] => {
      for (let i = 1; i < STAR_STOPS.length; i++) {
        if (temp <= STAR_STOPS[i][0]) {
          const [t0, c0] = STAR_STOPS[i - 1]
          const [t1, c1] = STAR_STOPS[i]
          const f = (temp - t0) / (t1 - t0 || 1)
          return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
        }
      }
      return STAR_STOPS[STAR_STOPS.length - 1][1]
    }

    // ── starfield ─────────────────────────────────────────────────────────────
    let stars: Star[] = []
    function seedStars() {
      const target = Math.round(((width * height) / 3500) * density)
      const count = Math.max(120, Math.min(560, target))
      const r2 = mulberry32(99)
      stars = Array.from({ length: count }, () => {
        const bright = Math.pow(r2(), 2.0) // power-law: many faint, few bright
        const [cr, cg, cb] = starColor(r2())
        return {
          x: r2(),
          y: r2(),
          size: 0.35 + bright * 1.7,
          bright,
          tw: 0.5 + r2() * 2,
          ph: r2() * Math.PI * 2,
          cr,
          cg,
          cb,
          spikes: bright > 0.9,
        }
      })
    }

    function resize() {
      width = container!.clientWidth
      height = container!.clientHeight
      canvas!.width = Math.floor(width * dpr)
      canvas!.height = Math.floor(height * dpr)
      canvas!.style.width = `${width}px`
      canvas!.style.height = `${height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      seedStars()
    }

    function spawnMeteor() {
      const fromTop = Math.random() < 0.5
      const x = fromTop ? Math.random() * width : -40
      const y = fromTop ? -40 : Math.random() * height * 0.5
      const speed = 6 + Math.random() * 5
      const ang = Math.PI * (0.18 + Math.random() * 0.12) // down-right
      meteors.push({
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        len: 90 + Math.random() * 120,
        life: 1,
        maxLife: 1,
      })
    }

    let t = 0
    function render() {
      if (!width || !height) return
      if (!reduceMotion) t += 1

      ctx!.clearRect(0, 0, width, height)

      // Parallax + revolve, both steered by the cursor.
      const baseCx = width * 0.5
      const baseCy = height * 0.45
      const targetPx = mouse.active ? (mouse.tx - baseCx) * 0.06 : 0
      const targetPy = mouse.active ? (mouse.ty - baseCy) * 0.06 : 0
      pxOff += (targetPx - pxOff) * 0.04
      pyOff += (targetPy - pyOff) * 0.04
      const cx = baseCx + pxOff
      const cy = baseCy + pyOff
      const base = Math.min(width, height) * 2.4
      if (!reduceMotion) spin += 0.0018
      steer += (steerTarget - steer) * 0.04
      const rot = spin + steer

      ctx!.globalCompositeOperation = 'lighter'

      // Stars
      for (const s of stars) {
        const tw = reduceMotion ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.02 * s.tw + s.ph))
        const alpha = (0.18 + 0.82 * s.bright) * tw
        const sx = s.x * width
        const sy = s.y * height
        const col = `${s.cr | 0}, ${s.cg | 0}, ${s.cb | 0}`

        // Soft bloom (brighter stars bloom larger)
        const gsize = 2 + s.bright * 16
        ctx!.globalAlpha = alpha * 0.6
        ctx!.drawImage(starGlow, sx - gsize / 2, sy - gsize / 2, gsize, gsize)

        // Colored core
        ctx!.globalAlpha = Math.min(1, alpha * 1.1)
        ctx!.fillStyle = `rgb(${col})`
        ctx!.beginPath()
        ctx!.arc(sx, sy, s.size, 0, Math.PI * 2)
        ctx!.fill()

        // Thin, tapered diffraction spikes — only on the brightest few
        if (s.spikes) {
          const L = 10 + s.bright * 26
          ctx!.lineWidth = 0.7
          const spike = (hx: number, hy: number) => {
            const g = ctx!.createLinearGradient(sx - hx, sy - hy, sx + hx, sy + hy)
            g.addColorStop(0, `rgba(${col}, 0)`)
            g.addColorStop(0.5, `rgba(${col}, ${alpha * 0.5})`)
            g.addColorStop(1, `rgba(${col}, 0)`)
            ctx!.strokeStyle = g
            ctx!.beginPath()
            ctx!.moveTo(sx - hx, sy - hy)
            ctx!.lineTo(sx + hx, sy + hy)
            ctx!.stroke()
          }
          spike(L, 0)
          spike(0, L)
        }
      }

      // Drifting gas layers
      const pulse = reduceMotion ? 1 : 1 + Math.sin(t * 0.01) * 0.03
      const drawNeb = (tex: HTMLCanvasElement, scale: number, rotation: number, alpha: number) => {
        ctx!.save()
        ctx!.translate(cx, cy)
        ctx!.rotate(rotation)
        ctx!.globalAlpha = alpha
        const sz = base * scale
        ctx!.drawImage(tex, -sz / 2, -sz / 2, sz, sz)
        ctx!.restore()
      }
      drawNeb(neb1, 1.0 * pulse, rot, 0.9)
      drawNeb(neb2, 0.78 * pulse, -rot * 1.6 + 0.6, 0.7)

      // Concentric multicolor shells (red / magenta / teal)
      const shellColors = [
        { s: 'rgba(240, 70, 90, ', glow: 'rgba(240, 70, 90, 0.5)' },
        { s: 'rgba(206, 96, 230, ', glow: 'rgba(206, 96, 230, 0.5)' },
        { s: 'rgba(90, 220, 200, ', glow: 'rgba(90, 220, 200, 0.45)' },
      ]
      ctx!.globalAlpha = 1
      for (let k = 0; k < 3; k++) {
        const r = base * (0.16 + k * 0.07)
        ctx!.save()
        ctx!.translate(cx, cy)
        ctx!.rotate(rot * (k % 2 ? -2 : 2) + k)
        ctx!.strokeStyle = `${shellColors[k].s}${0.16 - k * 0.03})`
        ctx!.lineWidth = 2
        ctx!.shadowBlur = 24
        ctx!.shadowColor = shellColors[k].glow
        ctx!.beginPath()
        ctx!.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2)
        ctx!.stroke()
        ctx!.restore()
      }
      ctx!.shadowBlur = 0

      // Bright core
      const coreR = base * 0.075 * (reduceMotion ? 1 : 1 + Math.sin(t * 0.03) * 0.08)
      const cg = ctx!.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      cg.addColorStop(0, 'rgba(255, 245, 255, 0.95)')
      cg.addColorStop(0.3, 'rgba(230, 160, 245, 0.6)')
      cg.addColorStop(1, 'rgba(180, 60, 220, 0)')
      ctx!.fillStyle = cg
      ctx!.beginPath()
      ctx!.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx!.fill()

      // Cursor activation — lights up the gas around the pointer
      if (mouse.active) {
        mouse.x += (mouse.tx - mouse.x) * 0.12
        mouse.y += (mouse.ty - mouse.y) * 0.12
        const mr = Math.min(width, height) * 0.34
        const mg = ctx!.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, mr)
        mg.addColorStop(0, 'rgba(236, 130, 220, 0.5)')
        mg.addColorStop(0.4, 'rgba(150, 60, 210, 0.22)')
        mg.addColorStop(1, 'rgba(120, 40, 180, 0)')
        ctx!.fillStyle = mg
        ctx!.beginPath()
        ctx!.arc(mouse.x, mouse.y, mr, 0, Math.PI * 2)
        ctx!.fill()
      }

      // Shooting stars
      if (!reduceMotion && --meteorCountdown <= 0) {
        spawnMeteor()
        meteorCountdown = 180 + Math.floor(Math.random() * 260)
      }
      for (let m = meteors.length - 1; m >= 0; m--) {
        const me = meteors[m]
        me.x += me.vx
        me.y += me.vy
        me.life -= 0.012
        if (me.life <= 0 || me.x > width + 60 || me.y > height + 60) {
          meteors.splice(m, 1)
          continue
        }
        const tailX = me.x - me.vx * (me.len / 8)
        const tailY = me.y - me.vy * (me.len / 8)
        const grad = ctx!.createLinearGradient(me.x, me.y, tailX, tailY)
        grad.addColorStop(0, `rgba(230, 220, 255, ${0.9 * me.life})`)
        grad.addColorStop(1, 'rgba(180, 130, 255, 0)')
        ctx!.strokeStyle = grad
        ctx!.lineWidth = 2
        ctx!.beginPath()
        ctx!.moveTo(me.x, me.y)
        ctx!.lineTo(tailX, tailY)
        ctx!.stroke()
      }

      // Click ripples
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pu = pulses[p]
        pu.r += 7
        pu.life -= 0.022
        if (pu.life <= 0) {
          pulses.splice(p, 1)
          continue
        }
        ctx!.strokeStyle = `rgba(214, 140, 255, ${pu.life * 0.6})`
        ctx!.lineWidth = 2
        ctx!.shadowBlur = 16
        ctx!.shadowColor = 'rgba(190, 90, 255, 0.6)'
        ctx!.beginPath()
        ctx!.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2)
        ctx!.stroke()
        ctx!.shadowBlur = 0
      }

      ctx!.globalAlpha = 1
      ctx!.globalCompositeOperation = 'source-over'
    }

    let raf = 0
    const loop = () => {
      render()
      raf = requestAnimationFrame(loop)
    }

    const onMove = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect()
      mouse.tx = e.clientX - rect.left
      mouse.ty = e.clientY - rect.top
      steerTarget = (mouse.tx / Math.max(1, width) - 0.5) * 2.0
      if (!mouse.active) {
        mouse.x = mouse.tx
        mouse.y = mouse.ty
        mouse.active = true
      }
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = mouse.y = mouse.tx = mouse.ty = -9999
    }
    const onDown = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect()
      pulses.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, r: 0, life: 1 })
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeave)
    window.addEventListener('mousedown', onDown)

    if (reduceMotion) render()
    else loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      window.removeEventListener('mousedown', onDown)
    }
  }, [density])

  return (
    <div ref={containerRef} className={`${className} pointer-events-none`} aria-hidden="true">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}

export default EquilibriumHeroBg
