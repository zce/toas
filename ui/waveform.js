// Display-only audio level normalization: preserve amplitude contrast while
// allowing low-gain microphones to produce a visible waveform.
const NOISE_FLOOR = 0.0006
const MIN_REFERENCE = 0.004
const REFERENCE_ATTACK = 0.25
const REFERENCE_RELEASE = 0.14
const SOFT_KNEE = 0.7

export class WaveformNormalizer {
  constructor() {
    this.reset()
  }

  reset() {
    this._reference = null
  }

  push(level) {
    const rms = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
    const target = Math.max(MIN_REFERENCE, rms)

    // Establish a sensible level from the first actual signal rather than
    // starting loud recordings with a fixed, much smaller reference.
    if (this._reference === null) {
      if (rms <= NOISE_FLOOR) return 0
      this._reference = target
    } else {
      // The reference tracks an envelope instead of following each new peak.
      // Immediate peak normalization made different loud samples all the same
      // height; a gradual attack preserves those differences.
      const speed = target > this._reference ? REFERENCE_ATTACK : REFERENCE_RELEASE
      this._reference += (target - this._reference) * speed
    }

    if (rms <= NOISE_FLOOR) return 0

    const ratio = (rms - NOISE_FLOOR) / (this._reference - NOISE_FLOOR)
    return ratio / (ratio + SOFT_KNEE)
  }
}
