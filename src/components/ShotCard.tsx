import { useEffect, useMemo, useState } from 'react'
import { downloadBlob } from '../lib/media'
import { ControlButton } from './ControlBar'

export interface Shot {
  blob: Blob
  url: string
  filename: string
  kind: 'image' | 'video'
}

const SHARE_URL = 'https://berkantkull.github.io/particle-me/'
const SHARE_TEXT = `PARTICLE ME ile yüzümü parçacıklara dönüştürdüm ✨ Sen de dene: ${SHARE_URL}`

/**
 * Preview of a captured photo or clip. Sharing goes through the Web Share API
 * (the native share sheet: WhatsApp, Instagram, …) and needs a tap, which is
 * why gesture-triggered captures land here instead of sharing directly.
 */
export function ShotCard({ shot, onClose }: { shot: Shot; onClose(): void }) {
  const file = useMemo(
    // Drop codec parameters ("video/webm;codecs=vp9"): share targets match on the bare type.
    () => new File([shot.blob], shot.filename, { type: shot.blob.type.split(';')[0] }),
    [shot],
  )
  const canShare = useMemo(() => {
    try {
      return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
    } catch {
      return false
    }
  }, [file])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const share = async () => {
    setBusy(true)
    try {
      await navigator.share({ files: [file], title: 'PARTICLE ME', text: SHARE_TEXT })
    } catch (err) {
      // Cancelling the share sheet is not an error; anything else falls back to a download.
      if (!(err instanceof DOMException && err.name === 'AbortError')) downloadBlob(shot.blob, shot.filename)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Kayıt önizlemesi"
    >
      <div
        className="w-full max-w-xs rounded-3xl border border-cyan-300/20 bg-black/80 p-3 shadow-[0_0_60px_rgba(34,211,238,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {shot.kind === 'image' ? (
          <img src={shot.url} alt="Parçacık portresi" className="max-h-[55dvh] w-full rounded-2xl object-contain" />
        ) : (
          <video src={shot.url} autoPlay loop muted playsInline className="max-h-[55dvh] w-full rounded-2xl object-contain" />
        )}
        <div className="mt-3 flex justify-center gap-1.5">
          {canShare && (
            <ControlButton primary onClick={share} disabled={busy}>
              PAYLAŞ
            </ControlButton>
          )}
          <ControlButton primary={!canShare} onClick={() => downloadBlob(shot.blob, shot.filename)}>
            İNDİR
          </ControlButton>
          <ControlButton onClick={onClose}>KAPAT</ControlButton>
        </div>
      </div>
    </div>
  )
}
