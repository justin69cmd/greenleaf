// Hand tracking via MediaPipe Tasks Vision (HandLandmarker, VIDEO mode).
//
// Streams the webcam, runs 21-landmark hand detection each frame, and reduces
// the landmarks to a compact GestureState the particle field can consume:
//
//   - position  : palm center, normalized & mirrored to screen space
//   - pinch     : thumb-tip ↔ index-tip distance (0 closed .. 1 wide)
//   - openness  : how spread/extended the fingers are (0 fist .. 1 open palm)
//   - swipe     : debounced left/right flick events (−1 / +1)
//
// The model + wasm load from the jsDelivr CDN at runtime. If the camera is
// denied or the model fails, `start()` rejects and the caller falls back to
// mouse control.

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision'

export interface GestureState {
  present: boolean
  /** Palm center, 0..1, already mirrored for a selfie view. */
  x: number
  y: number
  /** 0 (pinched) .. 1 (fingers far apart). */
  pinch: number
  /** 0 (fist) .. 1 (open palm). */
  openness: number
  /** −1 = swiped left, +1 = swiped right, 0 = none (edge event, one frame). */
  swipe: number
  /** True on the frame the hand transitions closed → open (palm "pop"). */
  palmPop: boolean
  /** Number of hands currently tracked: 0, 1, or 2. */
  hands: number
  /** Two-hand span: 0 (hands together) .. 1 (hands wide apart). */
  span: number
  /** Angle (radians) of the line between the two hands, for twist/orbit. */
  spanAngle: number
}

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type TrackerErrorKind =
  | 'insecure'
  | 'unsupported'
  | 'camera'
  | 'model'

export class TrackerError extends Error {
  constructor(public kind: TrackerErrorKind, message: string) {
    super(message)
    this.name = 'TrackerError'
  }
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null
  private video: HTMLVideoElement
  private stream: MediaStream | null = null
  private raf = 0
  private lastVideoTime = -1
  private running = false

  // Swipe detection state.
  private lastX = 0.5
  private swipeCooldown = 0
  private smoothVX = 0
  private prevOpen = 1

  state: GestureState = {
    present: false,
    x: 0.5,
    y: 0.5,
    pinch: 0.5,
    openness: 1,
    swipe: 0,
    palmPop: false,
    hands: 0,
    span: 0,
    spanAngle: 0,
  }

  constructor() {
    this.video = document.createElement('video')
    this.video.playsInline = true
    this.video.muted = true
  }

  /** Expose the video element so the UI can show a small preview. */
  get videoEl() {
    return this.video
  }

  async start(): Promise<void> {
    // Secure-context guard — getUserMedia is blocked outside https/localhost.
    if (!window.isSecureContext) {
      throw new TrackerError(
        'insecure',
        'Camera needs a secure context. Open the app via https://greenleaf-backend.vercel.app/ (or https), not a file:// path or a LAN IP.',
      )
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new TrackerError('unsupported', 'This browser does not expose a camera API.')
    }

    // 1) Camera first, so the permission prompt appears immediately and any
    //    failure here is unambiguously a camera problem.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
    } catch (e) {
      const name = (e as DOMException)?.name || ''
      const msg =
        name === 'NotAllowedError'
          ? 'Camera permission was blocked. Click the camera icon in the address bar, allow access, and try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : name === 'NotReadableError'
              ? 'The camera is in use by another app (Zoom, Photo Booth, etc.). Close it and retry.'
              : `Could not start the camera (${name || 'unknown error'}).`
      throw new TrackerError('camera', msg)
    }

    this.video.srcObject = this.stream
    await this.video.play()

    // 2) Load the hand model. GPU delegate first, fall back to CPU.
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_CDN)
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
      }
    } catch (e) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
      throw new TrackerError(
        'model',
        'The hand-tracking model failed to download (needs internet to reach the MediaPipe CDN).',
      )
    }

    this.running = true
    this.loop()
  }

  private loop = () => {
    if (!this.running || !this.landmarker) return
    this.raf = requestAnimationFrame(this.loop)
    const v = this.video
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return
    this.lastVideoTime = v.currentTime

    let result: HandLandmarkerResult
    try {
      result = this.landmarker.detectForVideo(v, performance.now())
    } catch {
      return
    }
    this.reduce(result)
  }

  private reduce(result: HandLandmarkerResult) {
    const s = this.state
    s.swipe = 0
    s.palmPop = false
    if (this.swipeCooldown > 0) this.swipeCooldown -= 1

    const all = (result.landmarks || []).filter((l) => l && l.length >= 21)
    s.hands = all.length

    if (all.length === 0) {
      s.present = false
      s.span = 0
      return
    }
    s.present = true

    // Order hands left→right (mirrored screen x) so "primary" is stable-ish.
    const reduced = all.map((lm) => this.reduceHand(lm))
    reduced.sort((a, b) => a.x - b.x)
    const primary = reduced[0]

    // Drive the single-hand fields from the primary (leftmost) hand.
    s.x = primary.x
    s.y = primary.y
    s.pinch = primary.pinch
    s.openness = primary.openness

    // Palm "pop": closed → open transition on the primary hand triggers a burst.
    if (primary.openness > 0.65 && this.prevOpen <= 0.45) s.palmPop = true
    this.prevOpen = primary.openness

    if (reduced.length >= 2) {
      // --- Two-hand controls ---
      const a = reduced[0]
      const b = reduced[1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      // Normalize span: ~0.12 hands together .. ~0.8 wide apart.
      s.span = clamp01((d - 0.12) / 0.6)
      s.spanAngle = Math.atan2(dy, dx)
      // Suppress swipe while two-handed (the span gesture owns motion).
      this.lastX = s.x
      this.smoothVX = 0
      return
    }

    // --- One-hand swipe: smoothed horizontal velocity of palm center ---
    s.span = 0
    const vx = s.x - this.lastX
    this.lastX = s.x
    this.smoothVX = this.smoothVX * 0.6 + vx * 0.4
    if (this.swipeCooldown === 0 && Math.abs(this.smoothVX) > 0.045) {
      s.swipe = this.smoothVX > 0 ? 1 : -1
      this.swipeCooldown = 25 // frames before another swipe fires
      this.smoothVX = 0
    }
  }

  /** Reduce one hand's 21 landmarks to position / pinch / openness. */
  private reduceHand(lm: HandLandmarkerResult['landmarks'][number]) {
    const wrist = lm[0]
    const thumbTip = lm[4]
    const indexTip = lm[8]
    const indexMcp = lm[5]
    const pinkyMcp = lm[17]
    const middleTip = lm[12]
    const ringTip = lm[16]
    const pinkyTip = lm[20]

    // Palm center ≈ average of wrist + finger MCP knuckles. Mirror X for selfie.
    const cx = (wrist.x + indexMcp.x + pinkyMcp.x) / 3
    const cy = (wrist.y + indexMcp.y + pinkyMcp.y) / 3
    const palm = dist(indexMcp, pinkyMcp) + 1e-4

    const pinch = clamp01((dist(thumbTip, indexTip) / palm - 0.15) / 1.6)

    const tips = [indexTip, middleTip, ringTip, pinkyTip]
    let spread = 0
    for (const tp of tips) spread += Math.hypot(tp.x - cx, tp.y - cy)
    spread = spread / tips.length / palm
    const openness = clamp01((spread - 0.7) / 1.3)

    return { x: 1 - cx, y: cy, pinch, openness }
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.landmarker?.close()
    this.landmarker = null
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
