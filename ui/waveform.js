// Display-only normalization; never change the recording or ASR input.
const MIN_NOISE_FLOOR = 0.0006
const INITIAL_NOISE = 0.0005
const MAX_NOISE = 0.001
const NOISE_MARGIN = 3.3
const MIN_REFERENCE = 0.004
const REFERENCE_ATTACK = 0.25
const REFERENCE_RELEASE = 0.14
const REFERENCE_FAST_RELEASE = 0.65
const FAST_RELEASE_RATIO = 0.70
const FAST_RELEASE_WINDOWS = 3
const SOFT_KNEE = 0.7
// Leave quiet-input feedback intact; reduce only sustained, medium/high bars.
const DISPLAY_KNEE = 0.4
const HIGH_LEVEL_SLOPE = 0.68

export class WaveformNormalizer {
  constructor() {
    this.reset()
  }

  reset() {
    this._noise = INITIAL_NOISE
    this._reference = null
    this._lowFrames = 0
  }

  push(level) {
    const rms = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0

    // Follow quieter background samples, not loud speech or brief noise peaks.
    // Digital silence is not evidence of the ambient noise floor.
    if (rms >= MIN_NOISE_FLOOR / 4 && rms < this._noise * 2.5) {
      const rate = rms < this._noise ? 0.25 : 0.04
      this._noise = Math.min(MAX_NOISE, this._noise + (rms - this._noise) * rate)
    }
    const floor = Math.max(MIN_NOISE_FLOOR, this._noise * NOISE_MARGIN)
    if (rms <= floor) {
      this._lowFrames = 0
      return 0
    }

    const target = Math.max(MIN_REFERENCE, rms)
    if (this._reference === null) {
      this._reference = target
    } else {
      // Recover quickly only from sustained, large gain drops. Preserve
      // short speech valleys rather than renormalizing each new peak.
      this._lowFrames = target < this._reference * FAST_RELEASE_RATIO ? this._lowFrames + 1 : 0
      const speed = target > this._reference
        ? REFERENCE_ATTACK
        : this._lowFrames >= FAST_RELEASE_WINDOWS ? REFERENCE_FAST_RELEASE : REFERENCE_RELEASE
      this._reference += (target - this._reference) * speed
    }

    // MIN_REFERENCE > maximum floor (0.0033), keeping the ratio well-defined.
    const ratio = (rms - floor) / (this._reference - floor)
    const normalized = ratio / (ratio + SOFT_KNEE)
    return normalized <= DISPLAY_KNEE
      ? normalized
      : DISPLAY_KNEE + (normalized - DISPLAY_KNEE) * HIGH_LEVEL_SLOPE
  }
}
