// Copies the MediaPipe WASM runtime and downloads the landmarker models into
// public/ so the app is fully self-hosted (no runtime CDN calls).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmDst = join(root, 'public/mediapipe/wasm')
const modelDir = join(root, 'public/mediapipe/models')

const MODELS = {
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
}

if (existsSync(wasmSrc)) {
  mkdirSync(wasmDst, { recursive: true })
  cpSync(wasmSrc, wasmDst, { recursive: true })
  console.log('[mediapipe] wasm copied')
}

mkdirSync(modelDir, { recursive: true })
for (const [name, url] of Object.entries(MODELS)) {
  const target = join(modelDir, name)
  if (existsSync(target)) continue
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(target, Buffer.from(await res.arrayBuffer()))
    console.log(`[mediapipe] downloaded ${name}`)
  } catch (err) {
    // Not fatal: the app falls back to the remote model URL.
    console.warn(`[mediapipe] could not download ${name}: ${err.message}`)
  }
}
