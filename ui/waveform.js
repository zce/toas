// Normalize display levels only. Captured PCM and ASR input are untouched.
// The threshold is deliberately close to the s16 noise floor so very quiet
// microphones still produce visible feedback, not a speech/noise detector.
const NOISE_FLOOR = 0.0001
const MIN_REFERENCE = 0.001
const REFERENCE_ATTACK = 0.25
const REFERENCE_RELEASE = 0.14
const REFERENCE_FAST_RELEASE = 0.45
const FAST_RELEASE_RATIO = 0.12
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

    // Silence is not evidence of a microphone gain change: do not gradually
    // amplify the noise floor between spoken phrases.
    if (rms <= NOISE_FLOOR) {
      this._lowFrames = 0
      return 0
    }

    const target = Math.max(MIN_REFERENCE, rms)
    if (this._reference === null) {
      this._reference = target
    } else {
      // Keep short speech valleys intact. Only accelerate recovery after
      // several consecutive, dramatically quieter non-silent windows.
      this._lowFrames = target < this._reference * FAST_RELEASE_RATIO ? this._lowFrames + 1 : 0
      const speed = target > this._reference
        ? REFERENCE_ATTACK
        : this._lowFrames >= FAST_RELEASE_WINDOWS ? REFERENCE_FAST_RELEASE : REFERENCE_RELEASE
      this._reference += (target - this._reference) * speed
    }

    // Soft compression preserves contrast among loud peaks rather than
    // matching each new peak to the same fixed bar height.
    const ratio = (rms - NOISE_FLOOR) / (this._reference - NOISE_FLOOR)
    return ratio / (ratio + SOFT_KNEE)
  }
}
