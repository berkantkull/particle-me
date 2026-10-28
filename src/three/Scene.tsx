import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { isMobile, QUALITY, type Quality } from '../lib/quality'
import type { VisionTracker } from '../lib/tracker'
import { createSimulation } from './simulation'

export type Mode = 'form' | 'disperse'
export type ColorMode = 'cyan' | 'natural' | 'aurora' | 'mono'
const COLOR_INDEX: Record<ColorMode, number> = { cyan: 0, natural: 1, aurora: 2, mono: 3 }
// Scratch objects reused every frame to avoid per-frame allocations.
const tmpHand = new THREE.Vector3()
const tmpLevels = new THREE.Vector2()
const tmpCenter = new THREE.Vector2()

export interface CaptureApi {
  canvas: HTMLCanvasElement
  snapshot(): Promise<Blob>
}

interface SceneProps {
  quality: Quality
  mode: Mode
  colorMode: ColorMode
  resetToken: number
  tracker: VisionTracker
  /** Mouse / touch pushes particles only on the start screen, never over the portrait. */
  pointerEnabled: boolean
  captureRef: RefObject<CaptureApi | null>
  onLowFps(): void
  /** The browser dropped the WebGL context (common on iOS under memory pressure). */
  onContextLost(): void
}

export function Scene({ quality, captureRef, onLowFps, onContextLost, ...rest }: SceneProps) {
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, QUALITY[quality].maxDpr]}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 10], fov: 45, near: 0.1, far: 100 }}
      onCreated={({ gl }) => {
        gl.setClearColor('#000000', 1)
        gl.domElement.addEventListener('webglcontextlost', onContextLost)
      }}
    >
      <ParticlePortrait key={quality} quality={quality} {...rest} />
      <FpsMonitor onLowFps={onLowFps} />
      <CaptureBridge apiRef={captureRef} />
    </Canvas>
  )
}

type PortraitProps = Omit<SceneProps, 'captureRef' | 'onLowFps' | 'onContextLost'>

function ParticlePortrait({ quality, mode, colorMode, resetToken, tracker, pointerEnabled }: PortraitProps) {
  const gl = useThree((s) => s.gl)
  const preset = QUALITY[quality]
  const sim = useMemo(() => createSimulation(gl, preset.texSize, isMobile()), [gl, preset.texSize])
  useEffect(() => () => sim.dispose(), [sim])

  const textures = useMemo(() => {
    const make = (canvas: HTMLCanvasElement) => {
      const tex = new THREE.CanvasTexture(canvas)
      tex.minFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      return tex
    }
    return { face: make(tracker.state.faceCanvas), mask: make(tracker.state.maskCanvas) }
  }, [tracker])
  useEffect(
    () => () => {
      textures.face.dispose()
      textures.mask.dispose()
    },
    [textures],
  )

  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const impulse = useRef(0)
  const frameVersion = useRef(-1)
  const smooth = useRef({
    center: new THREE.Vector2(0.5, 0.5),
    aspect: 0.75,
    hasFace: 0,
    levels: new THREE.Vector2(0, 1),
    disperse: 0,
    hand: new THREE.Vector3(0, 0, -100),
    handStrength: 0,
    ring: 0,
  })

  // On the start screen the mouse / touch stands in for the hand.
  // Listening on window keeps it working under the HTML overlays.
  const pointer = useRef({ x: 0.5, y: 0.5, time: -Infinity })
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, time: performance.now() }
    }
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !e.relatedTarget) pointer.current.time = -Infinity
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', move)
    window.addEventListener('pointerup', leave)
    document.addEventListener('pointerout', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', move)
      window.removeEventListener('pointerup', leave)
      document.removeEventListener('pointerout', leave)
    }
  }, [])

  useEffect(() => {
    if (mode === 'disperse') impulse.current = 4.5
  }, [mode])

  const firstReset = useRef(resetToken)
  useEffect(() => {
    if (resetToken !== firstReset.current) sim.scatter()
  }, [resetToken, sim])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const s = smooth.current
    const ts = tracker.state
    const vp = state.viewport
    const ease = (rate: number) => 1 - Math.exp(-dt * rate)

    if (ts.hasFace) {
      const r = ts.rect
      s.center.lerp(tmpCenter.set(r.cx, r.cy), ease(6))
      s.aspect += (r.aspect - s.aspect) * ease(10)
      s.levels.lerp(tmpLevels.set(ts.levels[0], ts.levels[1]), ease(4))
    }
    s.hasFace += ((ts.hasFace ? 1 : 0) - s.hasFace) * ease(3)
    s.disperse += ((mode === 'disperse' ? 1 : 0) - s.disperse) * ease(2.2)

    const hand = ts.hand
    const mouse = pointer.current
    const mouseOn = pointerEnabled && !hand.present && performance.now() - mouse.time < 2500
    const src = hand.present ? hand : mouseOn ? mouse : null
    if (src) {
      const target = tmpHand.set((src.x - 0.5) * vp.width, (0.5 - src.y) * vp.height, 0.6)
      if (s.handStrength < 0.05) s.hand.copy(target)
      else s.hand.lerp(target, ease(14))
    }
    const handTarget = hand.present ? (hand.gesture === 'fist' || hand.gesture === 'thumbs' ? 0.15 : 1) : mouseOn ? 1.3 : 0
    s.handStrength += (handTarget - s.handStrength) * ease(6)
    s.ring += ((hand.present ? 1 : 0) - s.ring) * ease(6)

    if (ts.frameVersion !== frameVersion.current) {
      frameVersion.current = ts.frameVersion
      textures.face.needsUpdate = true
      textures.mask.needsUpdate = true
    }

    const size = Math.min(vp.height * 0.78, (vp.width * 0.86) / s.aspect)
    const v = sim.velUniforms
    v.tFace.value = textures.face
    v.tMask.value = textures.mask
    v.uHasFace.value = s.hasFace
    v.uLevels.value.copy(s.levels)
    v.uTime.value = state.clock.elapsedTime
    v.uDelta.value = dt
    v.uDisperse.value = s.disperse
    v.uImpulse.value = impulse.current
    v.uSize.value = size
    v.uAspect.value = s.aspect
    v.uHand.value.copy(s.hand)
    v.uHandStrength.value = s.handStrength
    v.uHandRadius.value = size * 0.2
    v.uView.value.set(vp.width, vp.height)
    sim.posUniforms.uDelta.value = dt
    impulse.current = 0

    const r = sim.renderUniforms
    r.uPointSize.value = preset.pointSize
    r.uPointScale.value = (state.size.height * state.viewport.dpr) / 90
    r.uColorMode.value = COLOR_INDEX[colorMode]

    sim.step()

    // Subtle parallax that follows head position, plus a slow idle drift.
    const t = state.clock.elapsedTime
    if (group.current) {
      const g = group.current.rotation
      g.y += ((s.center.x - 0.5) * 0.35 * s.hasFace + Math.sin(t * 0.21) * 0.06 - g.y) * ease(3)
      g.x += ((s.center.y - 0.5) * 0.2 * s.hasFace + Math.sin(t * 0.17) * 0.03 - g.x) * ease(3)
    }
    if (ring.current) {
      ring.current.position.copy(s.hand)
      ring.current.scale.setScalar(size * 0.12 * (1 + Math.sin(t * 4) * 0.05))
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = s.handStrength * s.ring * 0.35
    }
  })

  return (
    <>
      <group ref={group}>
        <primitive object={sim.points} />
      </group>
      <mesh ref={ring}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  )
}

/** Reports sustained low frame rates (two consecutive slow windows) so the app can step quality down. */
function FpsMonitor({ onLowFps }: { onLowFps(): void }) {
  const acc = useRef({ frames: 0, time: 0, warmup: 3, slow: 0 })
  useFrame((_, delta) => {
    const a = acc.current
    if (a.warmup > 0) {
      a.warmup -= delta
      return
    }
    a.frames++
    a.time += delta
    if (a.time >= 3) {
      a.slow = a.frames / a.time < 40 ? a.slow + 1 : 0
      if (a.slow >= 2) {
        onLowFps()
        a.slow = 0
        a.warmup = 4
      }
      a.frames = 0
      a.time = 0
    }
  })
  return null
}

function CaptureBridge({ apiRef }: { apiRef: RefObject<CaptureApi | null> }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    apiRef.current = {
      canvas: gl.domElement,
      snapshot() {
        // Render and copy in the same task, so the drawing buffer is still valid
        // without paying for preserveDrawingBuffer every frame.
        gl.render(scene, camera)
        const src = gl.domElement
        const out = document.createElement('canvas')
        out.width = src.width
        out.height = src.height
        const ctx = out.getContext('2d')!
        ctx.drawImage(src, 0, 0)
        const pad = Math.round(out.height * 0.03)
        ctx.font = `600 ${Math.round(out.height * 0.016)}px ui-monospace, Menlo, Consolas, monospace`
        ctx.fillStyle = 'rgba(165, 243, 252, 0.6)'
        ctx.fillText('PARTICLE ME · © BERKANT KUL', pad, out.height - pad)
        return new Promise((resolve, reject) =>
          out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG oluşturulamadı'))), 'image/png'),
        )
      },
    }
    return () => {
      apiRef.current = null
    }
  }, [gl, scene, camera, apiRef])
  return null
}
