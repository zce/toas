// Normalize display levels only; keep capture and ASR unchanged.
// Suppress low-level microphone/ambient noise before adaptive normalization.
const NOISE_FLOOR = 0.001
const MIN_REFERENCE = 0.004
const REFERENCE_ATTACK = 0.25
const REFERENCE_RELEASE = 0.14
const REFERENCE_FAST_RELEASE = 0.55
const FAST_RELEASE_RATIO = 0.45
const FAST_RELEASE_WINDOWS = 3
const SOFT_KNEE = 0.7

export class WaveformNormalizer {
  constructor() {
    this.reset()
  }

  reset() {
    this._reference = null
    this._lowFrames = 0
  }

  push(level) {
    const rms = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0

    // Sub-threshold input must never train the gain envelope; otherwise
    // steady ambient noise could be amplified into an active waveform.
    if (rms <= NOISE_FLOOR) {
      this._lowFrames = 0
      return 0
    }

    const target = Math.max(MIN_REFERENCE, rms)
    if (this._reference === null) {
      this._reference = target
    } else {
      // Adapt only to sustained, large gain drops. Preserve momentary
      // speech valleys instead of normalizing each frame to the same height.
      this._lowFrames = target < this._reference * FAST_RELEASE_RATIO ? this._lowFrames + 1 : 0
      const speed = target > this._reference
        ? REFERENCE_ATTACK
        : this._lowFrames >= FAST_RELEASE_WINDOWS ? REFERENCE_FAST_RELEASE : REFERENCE_RELEASE
      this._reference += (target - this._reference) * speed
    }

    const ratio = (rms - NOISE_FLOOR) / (this._reference - NOISE_FLOOR)
    return ratio / (ratio + SOFT_KNEE)
  }
}
