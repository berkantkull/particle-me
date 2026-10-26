/** Saves a blob on the user's device; nothing leaves the browser. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4',
]

export function recordingMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

/** Records the WebGL canvas into a short clip using MediaRecorder. */
export class ClipRecorder {
  private recorder: MediaRecorder | null = null
  private timer = 0

  get active() {
    return this.recorder !== null
  }

  start(canvas: HTMLCanvasElement, maxMs: number, onDone: (blob: Blob, ext: string) => void): boolean {
    const mimeType = recordingMimeType()
    if (!mimeType || this.recorder) return false
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      clearTimeout(this.timer)
      this.recorder = null
      onDone(new Blob(chunks, { type: mimeType }), mimeType.startsWith('video/mp4') ? 'mp4' : 'webm')
    }
    recorder.start(250)
    this.recorder = recorder
    this.timer = window.setTimeout(() => this.stop(), maxMs)
    return true
  }

  stop() {
    if (this.recorder?.state === 'recording') this.recorder.stop()
  }
}
