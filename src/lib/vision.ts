import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const BASE = import.meta.env.BASE_URL
const REMOTE = 'https://storage.googleapis.com/mediapipe-models'
const MODELS = {
  face: [`${BASE}mediapipe/models/face_landmarker.task`, `${REMOTE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`],
  hand: [`${BASE}mediapipe/models/hand_landmarker.task`, `${REMOTE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`],
}

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
let filesetPromise: Promise<Fileset> | null = null
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`))

/** Tries each model URL with the GPU delegate first, then CPU. */
async function create<T>(urls: string[], factory: (path: string, delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  let lastError: unknown
  for (const url of urls) {
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        return await factory(url, delegate)
      } catch (err) {
        lastError = err
      }
    }
  }
  throw lastError
}

export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  const fs = await fileset()
  return create(MODELS.face, (modelAssetPath, delegate) =>
    FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  )
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fs = await fileset()
  return create(MODELS.hand, (modelAssetPath, delegate) =>
    HandLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    }),
  )
}
