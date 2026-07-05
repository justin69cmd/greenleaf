// ParticleField — the three.js engine.
//
// One fixed pool of particles. Each particle is a spring-damper mass pulled
// toward a per-particle target. Switching templates re-fills the target buffer
// and the particles flow smoothly into the new shape. Gestures feed in as a
// small control struct each frame: expansion (scale), a burst impulse, a hue
// shift, and a swirl amount.
//
// Rendering: additive soft-glow point sprites + UnrealBloom for a cinematic,
// realistic light-emission look.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import {
  TEMPLATE_BY_ID,
  type Template,
  type TemplateId,
} from './templates'

export interface FieldControls {
  /** Overall shape scale, ~0.5 (pinched) .. ~2.2 (spread). */
  expansion: number
  /** Hue rotation 0..1 applied on top of base colors. */
  hue: number
  /** Swirl/rotation drive 0..1 (e.g. from hand openness). */
  swirl: number
  /** Set true for a single frame to fire an outward burst from a point. */
  burst: boolean
  /** Burst origin in normalized [-1,1] screen-ish space. */
  burstX: number
  burstY: number
  /** Whether a hand is currently controlling the field (affects auto-motion). */
  active: boolean
  /** Extra Y-rotation (radians) to apply this frame — e.g. two-hand twist. */
  orbitDelta?: number
}

export class ParticleField {
  readonly count: number
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private points: THREE.Points
  private material: THREE.ShaderMaterial
  private geom: THREE.BufferGeometry

  // CPU simulation buffers.
  private pos: Float32Array
  private vel: Float32Array
  private target: Float32Array
  private baseColor: Float32Array // template's resting color
  private seed: Float32Array
  private life: Float32Array // fireworks: remaining life 0..1 (0 = dead)

  private current: Template
  private fireworksMode = false
  private fwCursor = 0
  private fwTimer = 0

  private clock = new THREE.Clock()
  private group: THREE.Group
  private disposed = false

  constructor(canvas: HTMLCanvasElement, count = 16000) {
    this.count = count

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x05060d, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x05060d, 0.0042)

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000)
    this.camera.position.set(0, 0, 78)

    this.group = new THREE.Group()
    this.scene.add(this.group)

    // --- buffers ---
    const n = count
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.target = new Float32Array(n * 3)
    this.baseColor = new Float32Array(n * 3)
    this.seed = new Float32Array(n)
    this.life = new Float32Array(n)
    for (let i = 0; i < n; i++) this.seed[i] = Math.random()

    this.current = TEMPLATE_BY_ID.heart
    this.current.fill(n, this.target, this.baseColor)
    // Start scattered so the first template "assembles" on load.
    for (let i = 0; i < n * 3; i += 3) {
      this.pos[i] = (Math.random() * 2 - 1) * 90
      this.pos[i + 1] = (Math.random() * 2 - 1) * 90
      this.pos[i + 2] = (Math.random() * 2 - 1) * 90
    }

    // --- geometry & material ---
    this.geom = new THREE.BufferGeometry()
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geom.setAttribute('aColor', new THREE.BufferAttribute(this.baseColor, 3))
    this.geom.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1))
    this.geom.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1))

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHue: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uSize: { value: 15 },
        uFireworks: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geom, this.material)
    this.points.frustumCulled = false
    this.group.add(this.points)

    // --- post-processing bloom ---
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.55, // strength
      0.45, // radius
      0.25, // threshold
    )
    this.composer.addPass(this.bloom)

    this.resize()
  }

  resize() {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio()
  }

  setTemplate(id: TemplateId) {
    const tpl = TEMPLATE_BY_ID[id]
    if (!tpl) return
    this.current = tpl
    this.fireworksMode = !!tpl.fireworks
    tpl.fill(this.count, this.target, this.baseColor)
    ;(this.geom.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
    this.material.uniforms.uFireworks.value = this.fireworksMode ? 1 : 0
    if (this.fireworksMode) {
      // Park everything dead; bursts will revive particles.
      this.life.fill(0)
      this.fwTimer = 0
    } else {
      this.life.fill(1)
    }
  }

  get templateId(): TemplateId {
    return this.current.id
  }

  /** Outward impulse from a screen-space point (normalized -1..1). */
  private applyBurst(nx: number, ny: number, strength: number) {
    // Project the normalized point onto the z=0 plane in world space.
    const wx = nx * 36
    const wy = ny * 24
    for (let i = 0; i < this.count; i++) {
      const o = i * 3
      const dx = this.pos[o] - wx
      const dy = this.pos[o + 1] - wy
      const dz = this.pos[o + 2]
      const d = Math.hypot(dx, dy, dz) + 0.001
      const falloff = strength * Math.exp(-d / 30)
      this.vel[o] += (dx / d) * falloff + (Math.random() * 2 - 1) * 2
      this.vel[o + 1] += (dy / d) * falloff + (Math.random() * 2 - 1) * 2
      this.vel[o + 2] += (dz / d) * falloff
    }
  }

  /** Launch a single firework: revive a slice of particles from one point. */
  private launchFirework() {
    const slice = Math.floor(this.count * 0.06)
    const ox = (Math.random() * 2 - 1) * 34
    const oy = 6 + Math.random() * 22
    const oz = (Math.random() * 2 - 1) * 20
    const hue = Math.random()
    const speed = 24 + Math.random() * 14
    for (let k = 0; k < slice; k++) {
      const i = this.fwCursor
      this.fwCursor = (this.fwCursor + 1) % this.count
      const o = i * 3
      this.pos[o] = ox
      this.pos[o + 1] = oy
      this.pos[o + 2] = oz
      // Random direction on a sphere → spherical burst.
      const u = Math.random()
      const v = Math.random()
      const theta = u * Math.PI * 2
      const phi = Math.acos(2 * v - 1)
      const sp = speed * (0.5 + 0.5 * Math.random())
      this.vel[o] = Math.sin(phi) * Math.cos(theta) * sp
      this.vel[o + 1] = Math.cos(phi) * sp
      this.vel[o + 2] = Math.sin(phi) * Math.sin(theta) * sp
      this.life[i] = 1
      // Slight per-particle hue variation around the burst's hue.
      const c = o
      hslInto(hue + (Math.random() - 0.5) * 0.08, 0.9, 0.62, this.baseColor, c)
    }
    ;(this.geom.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
  }

  update(ctrl: FieldControls) {
    const dt = Math.min(this.clock.getDelta(), 0.05)
    const t = this.clock.elapsedTime
    this.material.uniforms.uTime.value = t
    this.material.uniforms.uHue.value = ctrl.hue

    if (ctrl.burst && !this.fireworksMode) {
      this.applyBurst(ctrl.burstX, ctrl.burstY, 60)
    }

    if (this.fireworksMode) {
      this.simFireworks(dt, ctrl)
    } else {
      this.simShape(dt, ctrl)
    }

    ;(this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true

    // Gentle auto-rotation; faster with swirl gesture, plus direct two-hand twist.
    const spin = 0.06 + ctrl.swirl * 0.9
    this.group.rotation.y += dt * spin + (ctrl.orbitDelta || 0)
    this.group.rotation.x = Math.sin(t * 0.1) * 0.12

    this.composer.render()
  }

  private simShape(dt: number, ctrl: FieldControls) {
    const scale = ctrl.expansion
    const k = 9 // spring stiffness
    const damp = Math.exp(-2.2 * dt) // velocity damping per frame
    const pos = this.pos
    const vel = this.vel
    const tgt = this.target
    const seed = this.seed
    const t = this.clock.elapsedTime
    const swirl = ctrl.swirl
    for (let i = 0; i < this.count; i++) {
      const o = i * 3
      const s = seed[i]
      // Organic drift so the shape breathes even at rest.
      const nx = Math.sin(t * 0.7 + s * 31.4) * 0.8
      const ny = Math.cos(t * 0.6 + s * 17.1) * 0.8
      const nz = Math.sin(t * 0.5 + s * 9.3) * 0.8
      const txp = tgt[o] * scale + nx
      const typ = tgt[o + 1] * scale + ny
      const tzp = tgt[o + 2] * scale + nz
      vel[o] += (txp - pos[o]) * k * dt
      vel[o + 1] += (typ - pos[o + 1]) * k * dt
      vel[o + 2] += (tzp - pos[o + 2]) * k * dt
      // Tangential swirl around Y for a living, turbulent feel.
      if (swirl > 0.01) {
        const sw = swirl * 6 * dt
        vel[o] += -pos[o + 2] * sw * 0.02
        vel[o + 2] += pos[o] * sw * 0.02
      }
      vel[o] *= damp
      vel[o + 1] *= damp
      vel[o + 2] *= damp
      pos[o] += vel[o] * dt
      pos[o + 1] += vel[o + 1] * dt
      pos[o + 2] += vel[o + 2] * dt
    }
  }

  private simFireworks(dt: number, ctrl: FieldControls) {
    // Auto-launch cadence, plus on-demand bursts via the burst flag.
    this.fwTimer -= dt
    if (this.fwTimer <= 0) {
      this.launchFirework()
      this.fwTimer = 0.55 + Math.random() * 0.5
    }
    if (ctrl.burst) {
      this.launchFirework()
      this.launchFirework()
    }
    const pos = this.pos
    const vel = this.vel
    const life = this.life
    const g = -16 // gravity
    const drag = Math.exp(-0.9 * dt)
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) continue
      const o = i * 3
      vel[o + 1] += g * dt
      vel[o] *= drag
      vel[o + 1] *= drag
      vel[o + 2] *= drag
      pos[o] += vel[o] * dt
      pos[o + 1] += vel[o + 1] * dt
      pos[o + 2] += vel[o + 2] * dt
      life[i] -= dt * 0.34
      if (life[i] < 0) life[i] = 0
    }
  }

  render() {
    this.composer.render()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.geom.dispose()
    this.material.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

// hsl helper duplicated here (linear-ish) to avoid importing from templates.
function hslInto(h: number, s: number, l: number, out: Float32Array, o: number) {
  h = ((h % 1) + 1) % 1
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  out[o] = f(0)
  out[o + 1] = f(8)
  out[o + 2] = f(4)
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSeed;
  attribute float aLife;
  uniform float uTime;
  uniform float uHue;
  uniform float uPixelRatio;
  uniform float uSize;
  uniform float uFireworks;
  varying vec3 vColor;
  varying float vAlpha;

  // Rotate an RGB color around the hue axis.
  vec3 hueShift(vec3 col, float h) {
    const vec3 k = vec3(0.57735);
    float c = cos(h * 6.28318);
    float s = sin(h * 6.28318);
    return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
  }

  void main() {
    vec3 col = hueShift(aColor, uHue);

    // Fireworks particles fade + warm-shift as they die.
    float life = uFireworks > 0.5 ? aLife : 1.0;
    vColor = col * (0.55 + 0.85 * life);
    vAlpha = uFireworks > 0.5 ? smoothstep(0.0, 0.25, life) : 1.0;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Twinkle.
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + aSeed * 40.0);
    gl_PointSize = uSize * uPixelRatio * tw * (300.0 / -mv.z) * 0.12
                   * (uFireworks > 0.5 ? (0.6 + life) : 1.0);
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // Soft core + halo.
    float core = smoothstep(0.5, 0.0, d);
    float glow = pow(core, 2.6);
    float a = glow * vAlpha * 0.8;
    gl_FragColor = vec4(vColor * (0.18 + 0.95 * glow), a);
  }
`
