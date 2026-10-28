import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const BASE = import.meta.env.BASE_URL
const REMOTE = 'https://storage.googleapis.com/mediapipe-models'
const MODELS = {
  face: {
    urls: [`${BASE}mediapipe/models/face_landmarker.task`, `${REMOTE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`],
    // Fallback sizes for progress when the server sends no Content-Length.
    bytes: 3_758_596,
  },
  hand: {
    urls: [`${BASE}mediapipe/models/hand_landmarker.task`, `${REMOTE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`],
    bytes: 7_819_105,
  },
}

/** iPhone / iPad, including iPadOS reporting itself as a Mac. Every iOS browser runs WebKit. */
export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

// MediaPipe's GPU delegate can stall for a long time on its first run in iOS
// WebKit (shader compilation, extra WebGL contexts) — the page looks frozen
// until a reload hits the cache. XNNPACK on the CPU is fast enough there.
const delegates = (): ('GPU' | 'CPU')[] => (isIOS() ? ['CPU'] : ['GPU', 'CPU'])

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
let filesetPromise: Promise<Fileset> | null = null
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`))

// ---- Model download with progress -----------------------------------------

export interface ModelBuffers {
  face: Uint8Array
  hand: Uint8Array
}

let buffersPromise: Promise<ModelBuffers> | null = null
let progress = 0
const listeners = new Set<(percent: number) => void>()

/** Subscribes to download progress (0–100); returns an unsubscribe function. */
export function onModelProgress(fn: (percent: number) => void): () => void {
  listeners.add(fn)
  fn(progress)
  return () => listeners.delete(fn)
}

async function download(urls: string[], onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  let lastError: unknown
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
      const total = Number(res.headers.get('content-length')) || 0
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onBytes(loaded, total)
      }
      const out = new Uint8Array(loaded)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
      }
      return out
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/**
 * Downloads both models once (memoised). Safe to call early — the start screen
 * calls it in the background so START CAMERA usually finds them ready.
 */
export function preloadModels(): Promise<ModelBuffers> {
  if (buffersPromise) return buffersPromise
  const state = { face: [0, MODELS.face.bytes], hand: [0, MODELS.hand.bytes] }
  const report = () => {
    const loaded = state.face[0] + state.hand[0]
    const total = state.face[1] + state.hand[1]
    progress = Math.min(100, Math.round((loaded / total) * 100))
    listeners.forEach((fn) => fn(progress))
  }
  const track = (key: 'face' | 'hand') => (loaded: number, total: number) => {
    state[key] = [loaded, total || MODELS[key].bytes]
    report()
  }
  buffersPromise = Promise.all([download(MODELS.face.urls, track('face')), download(MODELS.hand.urls, track('hand'))])
    .then(([face, hand]) => ({ face, hand }))
    .catch((err) => {
      buffersPromise = null
      progress = 0
      throw err
    })
  return buffersPromise
}

// ---- Landmarkers ------------------------------------------------------------

/** Tries each delegate in turn (GPU first where it is reliable). */
async function create<T>(factory: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const delegate of delegates()) {
    try {
      return await factory(delegate)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

export async function createFaceLandmarker(model: Uint8Array): Promise<FaceLandmarker> {
  const fs = await fileset()
  return create((delegate) =>
    FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  )
}

export async function createHandLandmarker(model: Uint8Array): Promise<HandLandmarker> {
  const fs = await fileset()
  return create((delegate) =>
    HandLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    }),
  )
}
