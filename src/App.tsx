import { useCallback, useEffect, useRef, useState } from 'react'
import { ControlBar, ControlButton } from './components/ControlBar'
import { ShotCard, type Shot } from './components/ShotCard'
import { CameraError, startCamera, stopCamera } from './lib/camera'
import type { Gesture } from './lib/gesture'
import { ClipRecorder, recordingMimeType, timestamp } from './lib/media'
import { detectInitialQuality, particleCount, QUALITY, QUALITY_ORDER, type Quality } from './lib/quality'
import { VisionTracker } from './lib/tracker'
import { Scene, type CaptureApi, type ColorMode, type Mode } from './three/Scene'

type CamStatus = 'idle' | 'loading' | 'running' | 'error'

const COLORS: { id: ColorMode; label: string; swatch: string }[] = [
  { id: 'cyan', label: 'CYAN', swatch: 'linear-gradient(135deg,#1e40af,#22d3ee)' },
  { id: 'natural', label: 'NATURAL', swatch: 'linear-gradient(135deg,#7c4a32,#e8b89a)' },
  { id: 'aurora', label: 'AURORA', swatch: 'linear-gradient(135deg,#22d3ee,#a855f7)' },
  { id: 'mono', label: 'MONO', swatch: 'linear-gradient(135deg,#94a3b8,#f8fafc)' },
]
const MAX_CLIP_MS = 10_000
const COUNTDOWN_FROM = 3
const COPYRIGHT_YEAR = 2026

export default function App() {
  const [tracker] = useState(() => new VisionTracker())
  const [recorder] = useState(() => new ClipRecorder())
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureRef = useRef<CaptureApi | null>(null)

  const [status, setStatus] = useState<CamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('form')
  const [colorIndex, setColorIndex] = useState(0)
  const [quality, setQuality] = useState<Quality>(detectInitialQuality)
  const autoQuality = useRef(true)
  // Model loading and camera start-up block the main thread for a few seconds;
  // frame drops in that window say nothing about the device.
  const fpsGraceUntil = useRef(0)
  const [resetToken, setResetToken] = useState(0)
  const [showPreview, setShowPreview] = useState(true)
  const [recording, setRecording] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [hud, setHud] = useState({ face: false, hand: false, gesture: 'none' as Gesture, handsAvailable: true })
  const [shot, setShot] = useState<Shot | null>(null)
  const shotRef = useRef<Shot | null>(null)
  const [countdown, setCountdown] = useState(0)
  const countdownTimer = useRef(0)
  const [shutterKey, setShutterKey] = useState(0)

  const color = COLORS[colorIndex]
  const running = status === 'running'

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }, [])

  const openShot = useCallback((blob: Blob, filename: string, kind: Shot['kind']) => {
    if (shotRef.current) URL.revokeObjectURL(shotRef.current.url)
    const next = { blob, url: URL.createObjectURL(blob), filename, kind }
    shotRef.current = next
    setShot(next)
  }, [])

  const closeShot = useCallback(() => {
    if (shotRef.current) URL.revokeObjectURL(shotRef.current.url)
    shotRef.current = null
    setShot(null)
  }, [])

  const capture = useCallback(async () => {
    const api = captureRef.current
    if (!api) return
    setShutterKey((k) => k + 1)
    try {
      openShot(await api.snapshot(), `particle-me-${timestamp()}.png`, 'image')
    } catch {
      flash('KAYIT BAŞARISIZ')
    }
  }, [flash, openShot])

  const cancelCountdown = useCallback(() => {
    clearTimeout(countdownTimer.current)
    countdownTimer.current = 0
    setCountdown(0)
  }, [])

  // Hands-free selfie: 3-2-1, then capture. Ignored while one is already running
  // or a previous shot is still on screen.
  const startCountdown = useCallback(() => {
    if (countdownTimer.current || shotRef.current) return
    let n = COUNTDOWN_FROM
    setCountdown(n)
    const tick = () => {
      n -= 1
      if (n > 0) {
        setCountdown(n)
        countdownTimer.current = window.setTimeout(tick, 1000)
      } else {
        countdownTimer.current = 0
        setCountdown(0)
        capture()
      }
    }
    countdownTimer.current = window.setTimeout(tick, 1000)
  }, [capture])

  useEffect(() => {
    tracker.onGesture = (g) => {
      if (g === 'thumbs') startCountdown()
      else setMode(g === 'open' ? 'disperse' : 'form')
    }
    tracker.interval = QUALITY[quality].detectInterval
  }, [tracker, quality, startCountdown])

  useEffect(() => () => clearTimeout(countdownTimer.current), [])

  const stop = useCallback(() => {
    cancelCountdown()
    recorder.stop()
    tracker.stop()
    stopCamera(video, streamRef.current)
    streamRef.current = null
    setStatus('idle')
  }, [tracker, recorder, video, cancelCountdown])

  const start = useCallback(async () => {
    if (!video || status === 'loading') return
    setError(null)
    setStatus('loading')
    fpsGraceUntil.current = Infinity
    try {
      const { width, height } = QUALITY[quality].camera
      // Camera and models load in parallel; frames are processed only on-device.
      const [stream] = await Promise.all([startCamera(video, width, height), tracker.load()])
      streamRef.current = stream
      tracker.start(video)
      setMode('form')
      setStatus('running')
      fpsGraceUntil.current = performance.now() + 5000
    } catch (err) {
      tracker.stop()
      stopCamera(video, streamRef.current)
      streamRef.current = null
      console.error(err)
      setError(
        err instanceof CameraError
          ? err.message
          : 'Yüz takip modeli yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.',
      )
      setStatus('error')
      fpsGraceUntil.current = 0
    }
  }, [video, status, quality, tracker])

  // Release camera, detectors and recorder when the app goes away.
  useEffect(() => {
    const release = () => {
      recorder.stop()
      tracker.dispose()
      stopCamera(video, streamRef.current)
      streamRef.current = null
    }
    window.addEventListener('pagehide', release)
    return () => {
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [tracker, recorder, video])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      const s = tracker.state
      setHud((h) =>
        h.face === s.hasFace && h.hand === s.hand.present && h.gesture === s.hand.gesture && h.handsAvailable === s.handsAvailable
          ? h
          : { face: s.hasFace, hand: s.hand.present, gesture: s.hand.gesture, handsAvailable: s.handsAvailable },
      )
    }, 200)
    return () => clearInterval(id)
  }, [running, tracker])

  const toggleRecording = useCallback(() => {
    if (recorder.active) return recorder.stop()
    const api = captureRef.current
    if (!api) return
    const ok = recorder.start(api.canvas, MAX_CLIP_MS, (blob, ext) => {
      setRecording(false)
      openShot(blob, `particle-me-${timestamp()}.${ext}`, 'video')
    })
    setRecording(ok)
  }, [recorder, openShot])

  const reset = useCallback(() => {
    setMode('form')
    setResetToken((t) => t + 1)
  }, [])

  const cycleQuality = useCallback(() => {
    autoQuality.current = false
    setQuality((q) => QUALITY_ORDER[(QUALITY_ORDER.indexOf(q) + 1) % QUALITY_ORDER.length])
  }, [])

  const onLowFps = useCallback(() => {
    if (!autoQuality.current || performance.now() < fpsGraceUntil.current) return
    setQuality((q) => {
      const i = QUALITY_ORDER.indexOf(q)
      if (i === 0) return q
      flash(`KALİTE → ${QUALITY[QUALITY_ORDER[i - 1]].label}`)
      return QUALITY_ORDER[i - 1]
    })
  }, [flash])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || shotRef.current) return
      const k = e.key.toLowerCase()
      if (k === 'd') setMode('disperse')
      else if (k === 'r') setMode('form')
      else if (k === ' ') {
        e.preventDefault()
        setMode((m) => (m === 'form' ? 'disperse' : 'form'))
      } else if (k === 'x') reset()
      else if (k === 'c') capture()
      else if (k === 't') startCountdown()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reset, capture, startCountdown])

  const canRecord = recordingMimeType() !== null

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-black select-none">
      <Scene
        quality={quality}
        mode={mode}
        colorMode={color.id}
        resetToken={resetToken}
        tracker={tracker}
        captureRef={captureRef}
        onLowFps={onLowFps}
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.75)_100%)]" />

      {/* Header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:p-6">
        <div>
          <h1 className="font-mono text-sm font-bold tracking-[0.35em] text-cyan-100 sm:text-base">PARTICLE ME</h1>
          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-cyan-200/40">
            {(particleCount(quality) / 1000).toFixed(1)}K PARTICLES · {QUALITY[quality].label}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.2em] text-cyan-200/30">© BERKANT KUL</p>
        </div>
        {running && (
          <div className="flex flex-col items-end gap-1.5 font-mono text-[10px] tracking-[0.18em]">
            <StatusChip on={hud.face} label={hud.face ? 'FACE LOCKED' : 'SEARCHING FACE'} />
            {hud.handsAvailable && (
              <StatusChip
                on={hud.hand}
                label={hud.hand ? `HAND · ${hud.gesture === 'open' ? 'OPEN' : hud.gesture === 'fist' ? 'FIST' : hud.gesture === 'thumbs' ? 'THUMBS UP' : 'TRACKING'}` : 'NO HAND'}
              />
            )}
          </div>
        )}
      </header>

      {/* Start / error overlay */}
      {!running && (
        <section className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="pointer-events-auto max-w-sm rounded-[3rem] bg-[radial-gradient(closest-side,rgba(0,0,0,0.7),transparent)] px-10 py-12 text-center">
            <h2 className="font-mono text-2xl font-bold tracking-[0.4em] text-cyan-50 sm:text-3xl">PARTICLE ME</h2>
            <p className="mt-4 text-sm leading-relaxed text-cyan-100/60">
              Yüzün, gerçek zamanlı olarak binlerce parçacıktan oluşan bir portreye dönüşür. Elini aç, dağılsın; yumruk yap,
              yeniden birleşsin.
            </p>
            <div className="mt-8 flex justify-center">
              <ControlButton primary onClick={start} disabled={!video || status === 'loading'}>
                {status === 'loading' ? 'LOADING…' : 'START CAMERA'}
              </ControlButton>
            </div>
            {error && (
              <p role="alert" className="mt-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </p>
            )}
            <p className="mt-6 font-mono text-[10px] tracking-[0.15em] text-cyan-200/35">
              GÖRÜNTÜ CİHAZINDAN ÇIKMAZ · TÜM İŞLEME TARAYICIDA
            </p>
            <p className="mt-10 font-mono text-[10px] tracking-[0.2em] text-cyan-100/45">
              DEVELOPED BY <span className="text-cyan-100/80">BERKANT KUL</span>
            </p>
            <p className="mt-1.5 font-mono text-[9px] tracking-[0.15em] text-cyan-200/25">© {COPYRIGHT_YEAR} BERKANT KUL · MIT LICENSE</p>
          </div>
        </section>
      )}

      {/* Mirrored camera preview — kept in the DOM so the VideoTexture keeps updating. */}
      <video
        ref={setVideo}
        muted
        playsInline
        className={`pointer-events-none absolute top-20 right-4 w-20 -scale-x-100 sm:top-auto sm:bottom-24 rounded-xl border border-cyan-300/20 object-cover shadow-[0_0_30px_rgba(34,211,238,0.12)] transition-opacity duration-500 sm:right-6 sm:w-40 ${
          running && showPreview ? 'opacity-80' : 'opacity-0'
        }`}
      />

      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            key={countdown}
            className="countdown font-mono text-8xl font-bold text-cyan-50 drop-shadow-[0_0_30px_rgba(34,211,238,0.8)] sm:text-9xl"
          >
            {countdown}
          </span>
        </div>
      )}

      {shutterKey > 0 && <div key={shutterKey} className="shutter pointer-events-none absolute inset-0 bg-white" />}

      {shot && <ShotCard shot={shot} onClose={closeShot} />}

      {toast && (
        <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-black/60 px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-cyan-100 backdrop-blur">
          {toast}
        </div>
      )}

      {/* Controls */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6">
        {running && hud.handsAvailable && (
          <p className="font-mono text-[10px] tracking-[0.15em] text-cyan-200/40">✋ DAĞIT · ✊ BİRLEŞTİR · 👍 FOTOĞRAF</p>
        )}
        <ControlBar>
          <ControlButton primary={!running} active={running} onClick={running ? stop : start} disabled={!video || status === 'loading'}>
            {running ? 'STOP CAMERA' : 'START CAMERA'}
          </ControlButton>
          <ControlButton active={mode === 'disperse'} onClick={() => setMode('disperse')}>
            DISPERSE
          </ControlButton>
          <ControlButton active={mode === 'form'} onClick={() => setMode('form')}>
            RECONSTRUCT
          </ControlButton>
          <ControlButton onClick={reset}>RESET</ControlButton>
          <ControlButton onClick={capture}>CAPTURE</ControlButton>
          {canRecord && (
            <ControlButton active={recording} onClick={toggleRecording} title={`En fazla ${MAX_CLIP_MS / 1000} sn`}>
              <span className={`h-2 w-2 rounded-full ${recording ? 'animate-pulse bg-rose-400' : 'bg-rose-400/60'}`} />
              {recording ? 'STOP REC' : 'REC'}
            </ControlButton>
          )}
          <ControlButton onClick={() => setColorIndex((i) => (i + 1) % COLORS.length)} title="Particle color">
            <span className="h-3 w-3 rounded-full" style={{ background: color.swatch }} />
            {color.label}
          </ControlButton>
          <ControlButton onClick={cycleQuality} title="Quality">
            Q · {QUALITY[quality].label}
          </ControlButton>
          {running && (
            <ControlButton active={showPreview} onClick={() => setShowPreview((v) => !v)}>
              PREVIEW
            </ControlButton>
          )}
        </ControlBar>
      </footer>
    </main>
  )
}

function StatusChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`flex items-center gap-2 ${on ? 'text-cyan-100/80' : 'text-cyan-100/35'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-cyan-300 shadow-[0_0_8px_#67e8f9]' : 'bg-white/20'}`} />
      {label}
    </span>
  )
}
