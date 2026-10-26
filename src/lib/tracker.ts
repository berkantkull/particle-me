import type { FaceLandmarker, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import { classifyHand, GestureStabilizer, type Gesture } from './gesture'
import { createFaceLandmarker, createHandLandmarker } from './vision'

/** Face crop in normalized video coordinates (origin top-left, y down). */
export interface FaceRect {
  cx: number
  cy: number
  w: number
  h: number
  /** Pixel aspect (width / height) of the crop. */
  aspect: number
}

export interface HandState {
  present: boolean
  /** Palm centre in mirrored screen space, 0..1, y down. */
  x: number
  y: number
  /** Stabilised gesture. */
  gesture: Gesture
}

export interface TrackingState {
  hasFace: boolean
  rect: FaceRect
  /** Raw (unmirrored) camera pixels of the face crop. */
  faceCanvas: HTMLCanvasElement
  /** Soft face-oval mask in the same crop space. */
  maskCanvas: HTMLCanvasElement
  /** Bumped whenever faceCanvas / maskCanvas are redrawn. */
  frameVersion: number
  hand: HandState
  handsAvailable: boolean
  /** Robust luminance range (≈5th/95th percentile) of the face, for auto-levels. */
  levels: [number, number]
}

// Face-oval contour of the 478-point MediaPipe face mesh, in drawing order.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]
const PALM = [0, 5, 9, 13, 17]
const MASK_SIZE = 128
const FACE_SIZE = 256
const FACE_LOST_MS = 600
const LEVELS_SIZE = 32

/**
 * Runs MediaPipe on its own timer, independent of the render loop, and writes
 * results into a plain mutable `state` object that the renderer reads each frame.
 * Per detection it redraws two small canvases (face crop + mask) that the
 * renderer uploads as textures; no per-frame pixel arrays are created.
 */
export class VisionTracker {
  readonly state: TrackingState
  interval = 33
  onGesture: ((g: Gesture) => void) | null = null

  private face: FaceLandmarker | null = null
  private hand: HandLandmarker | null = null
  private loading: Promise<void> | null = null
  private video: HTMLVideoElement | null = null
  private running = false
  private timer = 0
  private lastVideoTime = -1
  private lastFaceSeen = 0
  private lastTimestamp = 0
  private stabilizer = new GestureStabilizer()
  private faceCtx: CanvasRenderingContext2D
  private maskCtx: CanvasRenderingContext2D
  private levelsCtx: CanvasRenderingContext2D
  private lumas = new Float32Array(LEVELS_SIZE * LEVELS_SIZE)

  constructor() {
    const face = document.createElement('canvas')
    face.width = face.height = FACE_SIZE
    this.faceCtx = face.getContext('2d')!
    const mask = document.createElement('canvas')
    mask.width = mask.height = MASK_SIZE
    this.maskCtx = mask.getContext('2d')!
    const levels = document.createElement('canvas')
    levels.width = levels.height = LEVELS_SIZE
    this.levelsCtx = levels.getContext('2d', { willReadFrequently: true })!
    this.state = {
      hasFace: false,
      rect: { cx: 0.5, cy: 0.5, w: 0.4, h: 0.55, aspect: 0.75 },
      faceCanvas: face,
      maskCanvas: mask,
      frameVersion: 0,
      hand: { present: false, x: 0.5, y: 0.5, gesture: 'none' },
      handsAvailable: true,
      levels: [0, 1],
    }
  }

  load(): Promise<void> {
    if (this.face) return Promise.resolve()
    return (this.loading ??= (async () => {
      try {
        // Hands are optional: the on-screen buttons still work without them.
        const [face, hand] = await Promise.all([createFaceLandmarker(), createHandLandmarker().catch(() => null)])
        this.face = face
        this.hand = hand
        this.state.handsAvailable = hand !== null
      } finally {
        this.loading = null
      }
    })())
  }

  start(video: HTMLVideoElement) {
    this.video = video
    this.running = true
    this.lastVideoTime = -1
    this.tick()
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    this.state.hasFace = false
    this.state.hand.present = false
    this.state.hand.gesture = 'none'
    this.stabilizer.reset()
  }

  dispose() {
    this.stop()
    this.face?.close()
    this.hand?.close()
    this.face = this.hand = null
    this.video = null
  }

  private tick = () => {
    if (!this.running) return
    const video = this.video
    let wait = 10
    if (video && this.face && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime
      const started = performance.now()
      try {
        this.detect(video, started)
      } catch (err) {
        console.warn('[tracker] detection failed', err)
      }
      wait = Math.max(0, this.interval - (performance.now() - started))
    }
    this.timer = window.setTimeout(this.tick, wait)
  }

  private detect(video: HTMLVideoElement, now: number) {
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1)
    this.lastTimestamp = ts
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return

    const face = this.face!.detectForVideo(video, ts).faceLandmarks[0]
    if (face) {
      this.updateFace(face, video)
      this.lastFaceSeen = now
      this.state.hasFace = true
    } else if (now - this.lastFaceSeen > FACE_LOST_MS) {
      this.state.hasFace = false
    }

    if (!this.hand) return
    const hand = this.state.hand
    const lm = this.hand.detectForVideo(video, ts).landmarks[0]
    let raw: Gesture = 'none'
    if (lm) {
      let x = 0
      let y = 0
      for (const i of PALM) {
        x += lm[i].x
        y += lm[i].y
      }
      x = 1 - x / PALM.length
      y /= PALM.length
      // Short exponential smoothing; snap on first sighting.
      const a = hand.present ? 0.45 : 1
      hand.x += (x - hand.x) * a
      hand.y += (y - hand.y) * a
      hand.present = true
      raw = classifyHand(lm, vw / vh)
    } else {
      hand.present = false
    }
    const committed = this.stabilizer.update(raw, now)
    hand.gesture = this.stabilizer.committed
    if (committed && committed !== 'none') this.onGesture?.(committed)
  }

  private updateFace(lm: NormalizedLandmark[], video: HTMLVideoElement) {
    const vw = video.videoWidth
    const vh = video.videoHeight
    let minX = 1
    let maxX = 0
    let minY = 1
    let maxY = 0
    for (const p of lm) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    // Smooth the crop here (not in the renderer) so image, mask and levels
    // are always produced from the exact same rectangle.
    const r = this.state.rect
    const a = this.state.hasFace ? 0.5 : 1
    r.cx += ((minX + maxX) / 2 - r.cx) * a
    r.cy += ((minY + maxY) / 2 - (maxY - minY) * 0.03 - r.cy) * a
    r.w += ((maxX - minX) * 1.22 - r.w) * a
    r.h += ((maxY - minY) * 1.22 - r.h) * a
    r.aspect = (r.w * vw) / (r.h * vh)
    const left = r.cx - r.w / 2
    const top = r.cy - r.h / 2

    // Face crop as an ordinary 2D canvas: uploading it is far more portable
    // than sampling a VideoTexture in a vertex shader (black on some GPUs).
    this.faceCtx.drawImage(video, left * vw, top * vh, r.w * vw, r.h * vh, 0, 0, FACE_SIZE, FACE_SIZE)

    // Face oval in crop space, pushed slightly outwards (more above the eyes to keep the forehead).
    let cx = 0
    let cy = 0
    for (const i of FACE_OVAL) {
      cx += lm[i].x
      cy += lm[i].y
    }
    cx /= FACE_OVAL.length
    cy /= FACE_OVAL.length
    const ctx = this.maskCtx
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE)
    ctx.filter = 'blur(3px)'
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    FACE_OVAL.forEach((i, n) => {
      const dx = lm[i].x - cx
      const dy = lm[i].y - cy
      const x = ((cx + dx * 1.06 - left) / r.w) * MASK_SIZE
      const y = ((cy + dy * (dy < 0 ? 1.12 : 1.04) - top) / r.h) * MASK_SIZE
      if (n === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fill()
    ctx.filter = 'none'

    this.updateLevels()
    this.state.frameVersion++
  }

  /**
   * Measures the face's brightness range from a 32×32 downsample of the inner
   * crop (a 4 KB read, once per detection) so dim or side-lit faces still use
   * the full tonal range of the particles.
   */
  private updateLevels() {
    const ctx = this.levelsCtx
    const inset = FACE_SIZE * 0.22
    ctx.drawImage(this.state.faceCanvas, inset, inset, FACE_SIZE - inset * 2, FACE_SIZE - inset * 2, 0, 0, LEVELS_SIZE, LEVELS_SIZE)
    const px = ctx.getImageData(0, 0, LEVELS_SIZE, LEVELS_SIZE).data
    const l = this.lumas
    for (let i = 0; i < l.length; i++) l[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255
    l.sort()
    const lo = l[Math.floor(l.length * 0.05)]
    const hi = l[Math.floor(l.length * 0.95)]
    this.state.levels = [lo, Math.max(hi, lo + 0.15)]
  }
}
