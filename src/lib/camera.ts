export class CameraError extends Error {}

/** Maps getUserMedia failures to messages a user can act on. */
function describe(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Kamera izni reddedildi. Tarayıcının adres çubuğundaki kamera simgesinden izin verip tekrar dene.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kullanılabilir bir kamera bulunamadı.'
    case 'NotReadableError':
    case 'AbortError':
      return 'Kamera başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamaları kapatıp tekrar dene.'
    default:
      return 'Kamera başlatılamadı. Sayfayı yenileyip tekrar dene.'
  }
}

export async function startCamera(video: HTMLVideoElement, width: number, height: number): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('Kamera erişimi yalnızca HTTPS veya localhost üzerinden çalışır.')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    })
  } catch (err) {
    throw new CameraError(describe(err))
  }
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }))
  }
  return stream
}

export function stopCamera(video: HTMLVideoElement | null, stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
  if (video) {
    video.pause()
    video.srcObject = null
  }
}
