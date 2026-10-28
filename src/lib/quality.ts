export type Quality = 'low' | 'medium' | 'high' | 'ultra'

export interface QualityPreset {
  label: string
  /** Simulation texture side; particle count = texSize². */
  texSize: number
  maxDpr: number
  /** Minimum ms between MediaPipe detection passes. */
  detectInterval: number
  pointSize: number
  camera: { width: number; height: number }
}

export const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high', 'ultra']

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { label: 'LOW', texSize: 100, maxDpr: 1, detectInterval: 70, pointSize: 3.2, camera: { width: 640, height: 480 } },
  medium: { label: 'MEDIUM', texSize: 142, maxDpr: 1.5, detectInterval: 45, pointSize: 2.9, camera: { width: 640, height: 480 } },
  high: { label: 'HIGH', texSize: 187, maxDpr: 2, detectInterval: 33, pointSize: 2.45, camera: { width: 960, height: 720 } },
  ultra: { label: 'ULTRA', texSize: 265, maxDpr: 2, detectInterval: 33, pointSize: 1.9, camera: { width: 1280, height: 720 } },
}

export const isMobile = (): boolean =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches)

/** Picks a starting quality from coarse device signals; the FPS monitor refines it later. */
export function detectInitialQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4
  if (isMobile()) return cores >= 8 ? 'medium' : 'low'
  return cores >= 4 ? 'high' : 'medium'
}

export const particleCount = (q: Quality) => QUALITY[q].texSize ** 2
