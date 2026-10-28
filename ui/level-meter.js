// Display-only audio input feedback; does not detect speech or alter recorded audio.
const INPUT_FLOOR = 0.0016
const MIN_REFERENCE = 0.004
const RISE_RATE = 0.2
const FALL_RATE = 0.4
const COMPRESSION = 0.8
const DISPLAY_GAIN = 0.88
const START_WINDOWS = 2
const STOP_WINDOWS = 3

export class AudioLevelMeter {
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

    if (instant <= INPUT_FLOOR) {
      this._start = 0
      if (this.active && ++this._quiet >= STOP_WINDOWS) {
        this.active = false
        this._slow = 0
        this._quiet = 0
      }
      return 0
    }

    // Ignore isolated peaks at startup; the recorder reports every 100 ms.
    if (!this.active) {
      if (++this._start < START_WINDOWS) return 0
      this.active = true
      this._start = 0
      this._slow = Math.max(MIN_REFERENCE, instant)
    } else {
      this._quiet = 0
      const rate = instant > this._slow ? RISE_RATE : FALL_RATE
      this._slow += rate * (instant - this._slow)
    }

    // A slow reference preserves variation and makes low microphone gain visible.
    const ratio = (instant - INPUT_FLOOR) / (Math.max(MIN_REFERENCE, this._slow) - INPUT_FLOOR)
    return DISPLAY_GAIN * ratio / (ratio + COMPRESSION)
  }
}
