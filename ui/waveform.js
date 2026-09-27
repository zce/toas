// Normalizes the recorder's raw RMS for display only. Never modify captured
// PCM or feed these levels back into speech processing.
const NOISE_FLOOR = 0.0006
const MIN_REFERENCE = 0.004
const INITIAL_REFERENCE = 0.025
const REFERENCE_RELEASE = 0.9
const HEADROOM = 1.35
const CURVE = 0.8

export class WaveformNormalizer {
  constructor() {
    this.reset()
  }

  reset() {
    this._reference = INITIAL_REFERENCE
  }

  push(level) {
    const rms = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0

    // Follow louder input immediately; recover sensitivity smoothly when the
    // microphone level falls. Headroom keeps sustained speech off the ceiling.
    this._reference = Math.max(MIN_REFERENCE, this._reference * REFERENCE_RELEASE, rms * HEADROOM)

    if (rms <= NOISE_FLOOR) return 0
    return Math.min(1, Math.pow((rms - NOISE_FLOOR) / (this._reference - NOISE_FLOOR), CURVE))
  }
}
