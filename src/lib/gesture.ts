import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type Gesture = 'open' | 'fist' | 'thumbs' | 'none'

const TIPS = [8, 12, 16, 20]
const PIPS = [6, 10, 14, 18]

/** Classifies a single hand pose from its 21 landmarks. `aspect` = video width / height. */
export function classifyHand(lm: NormalizedLandmark[], aspect: number): Gesture {
  const d = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
  const wrist = lm[0]
  let extended = 0
  for (let i = 0; i < 4; i++) {
    if (d(lm[TIPS[i]], wrist) > d(lm[PIPS[i]], wrist) * 1.15) extended++
  }
  const palm = d(lm[0], lm[9])
  const tipSpread = TIPS.reduce((s, t) => s + d(lm[t], wrist), 0) / 4 / palm
  if (extended >= 4 && tipSpread > 1.55) return 'open'
  // Thumbs up: fingers curled, thumb pointing up (image y grows downwards)
  // and clearly away from the knuckles. Checked before fist, which it resembles.
  const thumbUp =
    lm[4].y < lm[3].y && lm[3].y < lm[2].y && lm[4].y < lm[5].y - palm * 0.35 && d(lm[4], lm[5]) > palm * 0.6
  if (extended === 0 && thumbUp) return 'thumbs'
  if (extended === 0 && tipSpread < 1.25) return 'fist'
  return 'none'
}

/**
 * Debounces noisy per-frame classifications: a pose must be held for `holdMs`
 * (longer for thumbs up, which takes a photo) before it is committed, and
 * committed changes are rate-limited by `cooldownMs` so false positives cannot
 * make the particles flip modes repeatedly.
 */
export class GestureStabilizer {
  committed: Gesture = 'none'
  private candidate: Gesture = 'none'
  private candidateSince = 0
  private lastCommit = 0
  private holdMs: number
  private cooldownMs: number

  constructor(holdMs = 280, cooldownMs = 900) {
    this.holdMs = holdMs
    this.cooldownMs = cooldownMs
  }

  /** Returns the newly committed gesture, or null when nothing changed. */
  update(raw: Gesture, now: number): Gesture | null {
    if (raw !== this.candidate) {
      this.candidate = raw
      this.candidateSince = now
      return null
    }
    const hold = raw === 'thumbs' ? this.holdMs * 2 : this.holdMs
    if (raw === this.committed || now - this.candidateSince < hold) return null
    if (raw !== 'none' && now - this.lastCommit < this.cooldownMs) return null
    this.committed = raw
    if (raw !== 'none') this.lastCommit = now
    return raw
  }

  reset() {
    this.committed = this.candidate = 'none'
  }
}
