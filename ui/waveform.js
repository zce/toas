// Display-only RMS meter, following WebRTC SoundMeter's instant/slow split.
// This measures input activity, not whether a sound is human speech.
const NOISE_FLOOR = 0.0016
const MIN_REFERENCE = 0.004
const ATTACK = 0.2
const RELEASE = 0.4
const SOFT_KNEE = 0.8
const DISPLAY_GAIN = 0.88
const START_WINDOWS = 2
const STOP_WINDOWS = 3

export class VoiceLevelMeter {
  constructor() {
    this.reset()
  }

  reset() {
    this.active = false
    this._slow = 0
    this._start = 0
    this._quiet = 0
  }

  push(input) {
    const instant = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0

    // One isolated peak must not scroll across the eight display bars.
    // This conservative floor is not a voice activity detector.
    if (instant <= NOISE_FLOOR) {
      this._start = 0
      if (this.active && ++this._quiet >= STOP_WINDOWS) {
        this.active = false
        this._slow = 0
        this._quiet = 0
      }
      return 0
    }

    if (!this.active) {
      if (++this._start < START_WINDOWS) return 0
      this.active = true
      this._start = 0
      this._slow = Math.max(MIN_REFERENCE, instant)
    } else {
      this._quiet = 0
      // The 100 ms input windows need quicker release than the original
      // WebRTC demonstration's per-block smoothing.
      const speed = instant > this._slow ? ATTACK : RELEASE
      this._slow += speed * (instant - this._slow)
    }

    // The slow envelope controls visual scale while soft compression keeps
    // dense speech from filling every bar. Low microphone gain stays visible.
    const signal = instant - NOISE_FLOOR
    const reference = Math.max(MIN_REFERENCE, this._slow) - NOISE_FLOOR
    const ratio = signal / reference
    return DISPLAY_GAIN * ratio / (ratio + SOFT_KNEE)
  }
}
