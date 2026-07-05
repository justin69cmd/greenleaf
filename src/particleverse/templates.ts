// Particle templates.
//
// Every generator fills a `target` position buffer (length count*3) and a
// `color` base-color buffer (length count*3, linear RGB 0..1). The engine
// springs each particle toward its target and applies a global hue shift on
// top of the base color, so templates only need to describe the resting shape.
//
// World scale: shapes live roughly within a radius of ~26 units; the camera
// sits at z ≈ 78 looking at the origin.

export type TemplateId =
  | 'heart'
  | 'flower'
  | 'saturn'
  | 'galaxy'
  | 'fireworks'
  | 'sphere'
  | 'dna'
  | 'torus'

export interface Template {
  id: TemplateId
  label: string
  /** Whether this template runs the fireworks physics mode instead of spring-morphing. */
  fireworks?: boolean
  /** Fills `target` (count*3) and `color` (count*3) for a given particle count. */
  fill: (count: number, target: Float32Array, color: Float32Array) => void
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2
const rand = Math.random
/** Uniform in [-1, 1]. */
const rsym = () => rand() * 2 - 1

/** HSL → linear-ish RGB (good enough for additive glow). h,s,l in 0..1. */
function hsl(h: number, s: number, l: number, out: Float32Array, o: number) {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  out[o] = f(0)
  out[o + 1] = f(8)
  out[o + 2] = f(4)
}

/** Power-biased random in [0,1]; p>1 biases toward 0, p<1 toward 1. */
const biased = (p: number) => Math.pow(rand(), p)

// ---------------------------------------------------------------------------
// Heart — filled volumetric parametric heart
// ---------------------------------------------------------------------------

const heart: Template = {
  id: 'heart',
  label: 'Heart',
  fill(count, target, color) {
    const S = 1.25
    for (let i = 0; i < count; i++) {
      const t = rand() * TAU
      // Classic 2D heart curve.
      const hx = 16 * Math.pow(Math.sin(t), 3)
      const hy =
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)
      // Fill interior: pull toward centroid, keep more density near the shell.
      const f = biased(0.65)
      const cx = 0
      const cy = 4 // visual center of the heart
      const x = (cx + (hx - cx) * f) * S
      const y = (cy + (hy - cy) * f) * S
      // Give it body: thicker in the middle, thin at the cusp/point.
      const thickness = 6 * (0.35 + 0.65 * f)
      const z = rsym() * thickness
      const o = i * 3
      target[o] = x
      target[o + 1] = y
      target[o + 2] = z
      // Deep red core → hot pink shell.
      hsl(0.96 + 0.02 * f, 0.85, 0.42 + 0.18 * f, color, o)
    }
  },
}

// ---------------------------------------------------------------------------
// Flower — layered rose-curve bloom
// ---------------------------------------------------------------------------

const flower: Template = {
  id: 'flower',
  label: 'Flower',
  fill(count, target, color) {
    const petals = 6
    const R = 24
    for (let i = 0; i < count; i++) {
      const theta = rand() * TAU
      // Rose curve magnitude; |cos| keeps all petals.
      const petal = Math.abs(Math.cos(petals * 0.5 * theta))
      const rr = Math.pow(rand(), 0.5) // denser toward rim
      const radius = R * petal * (0.15 + 0.85 * rr)
      const x = Math.cos(theta) * radius
      const y = Math.sin(theta) * radius
      // Petals curl upward toward the rim; small jitter for body.
      const z = Math.pow(rr, 1.6) * 11 + rsym() * 1.2
      const o = i * 3
      target[o] = x
      target[o + 2] = y // lay the bloom facing the camera-ish, tilt in engine
      target[o + 1] = z - 3
      // Magenta rim → golden center.
      const center = 1 - rr
      hsl(0.9 - 0.18 * center, 0.8, 0.45 + 0.25 * center, color, o)
    }
  },
}

// ---------------------------------------------------------------------------
// Saturn — planet sphere + tilted ring system
// ---------------------------------------------------------------------------

const saturn: Template = {
  id: 'saturn',
  label: 'Saturn',
  fill(count, target, color) {
    const tilt = -0.42 // radians, ring tilt around X
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const planetFrac = 0.55
    const planetR = 12
    for (let i = 0; i < count; i++) {
      const o = i * 3
      let x: number, y: number, z: number
      if (rand() < planetFrac) {
        // Solid-ish planet: shell-biased sphere.
        const u = rand()
        const v = rand()
        const theta = TAU * u
        const phi = Math.acos(2 * v - 1)
        const r = planetR * (0.85 + 0.15 * rand())
        x = r * Math.sin(phi) * Math.cos(theta)
        y = r * Math.cos(phi)
        z = r * Math.sin(phi) * Math.sin(theta)
        // Warm sandy bands.
        const band = 0.5 + 0.5 * Math.sin(y * 0.9)
        hsl(0.1 + 0.02 * band, 0.55, 0.45 + 0.12 * band, color, o)
      } else {
        // Flat ring annulus, tilted.
        const ang = rand() * TAU
        const rr = 17 + Math.pow(rand(), 0.7) * 11
        const rx = Math.cos(ang) * rr
        const rz = Math.sin(ang) * rr
        x = rx
        y = rz * st
        z = rz * ct
        const t = (rr - 17) / 11
        hsl(0.09 + 0.04 * t, 0.4, 0.5 + 0.2 * (1 - t), color, o)
      }
      target[o] = x
      target[o + 1] = y
      target[o + 2] = z
    }
  },
}

// ---------------------------------------------------------------------------
// Galaxy — multi-arm logarithmic spiral with a glowing bulge
// ---------------------------------------------------------------------------

const galaxy: Template = {
  id: 'galaxy',
  label: 'Galaxy',
  fill(count, target, color) {
    const arms = 4
    const maxR = 28
    const spin = 3.4
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const rr = Math.pow(rand(), 0.6) // bulge dense at center
      const radius = rr * maxR
      const arm = Math.floor(rand() * arms)
      const armAngle = (arm / arms) * TAU
      const scatter = (rsym() * 0.45) / (rr + 0.25)
      const angle = armAngle + rr * spin + scatter
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      // Thin disk, thicker bulge.
      const y = rsym() * (1.2 + 6 * Math.exp(-rr * 4))
      target[o] = x
      target[o + 1] = y
      target[o + 2] = z
      // Hot white/gold core → cool blue rim.
      const core = Math.exp(-rr * 2.2)
      hsl(0.6 - 0.05 * core, 0.7 - 0.4 * core, 0.5 + 0.4 * core, color, o)
    }
  },
}

// ---------------------------------------------------------------------------
// Fireworks — physics mode. Resting layout is a loose shell; the engine
// actually launches bursts. Colors are randomized warm sparks.
// ---------------------------------------------------------------------------

const fireworks: Template = {
  id: 'fireworks',
  label: 'Fireworks',
  fireworks: true,
  fill(count, target, color) {
    for (let i = 0; i < count; i++) {
      const o = i * 3
      // Start them low / scattered; engine overrides via physics.
      target[o] = rsym() * 30
      target[o + 1] = -28 + rand() * 4
      target[o + 2] = rsym() * 30
      hsl(rand(), 0.9, 0.6, color, o)
    }
  },
}

// ---------------------------------------------------------------------------
// Sphere — fibonacci sphere shell
// ---------------------------------------------------------------------------

const sphere: Template = {
  id: 'sphere',
  label: 'Sphere',
  fill(count, target, color) {
    const R = 22
    const ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const y = 1 - (i / (count - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const phi = i * ga
      const jitter = 0.94 + 0.06 * rand()
      target[o] = Math.cos(phi) * r * R * jitter
      target[o + 1] = y * R * jitter
      target[o + 2] = Math.sin(phi) * r * R * jitter
      hsl(0.5 + 0.1 * y, 0.7, 0.55, color, o)
    }
  },
}

// ---------------------------------------------------------------------------
// DNA — double helix with rungs
// ---------------------------------------------------------------------------

const dna: Template = {
  id: 'dna',
  label: 'DNA',
  fill(count, target, color) {
    const turns = 5
    const R = 9
    const H = 46
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const u = rand()
      const yPos = (u - 0.5) * H
      const ang = u * turns * TAU
      const role = rand()
      if (role < 0.78) {
        // Two backbone strands.
        const strand = role < 0.39 ? 0 : Math.PI
        target[o] = Math.cos(ang + strand) * R + rsym() * 0.5
        target[o + 1] = yPos
        target[o + 2] = Math.sin(ang + strand) * R + rsym() * 0.5
        hsl(role < 0.39 ? 0.55 : 0.92, 0.8, 0.55, color, o)
      } else {
        // Rungs connecting the strands.
        const m = rand()
        const x0 = Math.cos(ang) * R
        const z0 = Math.sin(ang) * R
        const x1 = Math.cos(ang + Math.PI) * R
        const z1 = Math.sin(ang + Math.PI) * R
        target[o] = x0 + (x1 - x0) * m
        target[o + 1] = yPos
        target[o + 2] = z0 + (z1 - z0) * m
        hsl(0.15, 0.7, 0.6, color, o)
      }
    }
  },
}

// ---------------------------------------------------------------------------
// Torus
// ---------------------------------------------------------------------------

const torus: Template = {
  id: 'torus',
  label: 'Torus',
  fill(count, target, color) {
    const R = 17 // ring radius
    const r = 6.5 // tube radius
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const u = rand() * TAU
      const v = rand() * TAU
      const rr = r * (0.8 + 0.2 * rand())
      target[o] = (R + rr * Math.cos(v)) * Math.cos(u)
      target[o + 1] = rr * Math.sin(v)
      target[o + 2] = (R + rr * Math.cos(v)) * Math.sin(u)
      hsl(0.75 + 0.1 * Math.sin(u), 0.75, 0.55, color, o)
    }
  },
}

export const TEMPLATES: Template[] = [
  heart,
  flower,
  saturn,
  galaxy,
  fireworks,
  sphere,
  dna,
  torus,
]

export const TEMPLATE_BY_ID: Record<TemplateId, Template> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
) as Record<TemplateId, Template>
