// Display-only frequency feedback: the WAV capture path is unchanged.
export const SPECTRUM_BAR_COUNT = 13

const SIZE = 512

export class AudioSpectrum {
  constructor(sampleRate) {
    // Average groups of input samples instead of FFT-ing at 48 kHz.
    this._stride = Math.max(1, Math.floor(sampleRate / 8000))
    this._rate = sampleRate / this._stride
    this._ring = new Float32Array(SIZE)
    this._real = new Float32Array(SIZE)
    this._imag = new Float32Array(SIZE)
    this._window = new Float32Array(SIZE)
    this._cos = new Float32Array(SIZE / 2)
    this._sin = new Float32Array(SIZE / 2)
    this._reverse = new Uint16Array(SIZE)
    this._cursor = 0
    this._partialSum = 0
    this._partialCount = 0
    this._display = new Float32Array(SPECTRUM_BAR_COUNT)

    for (let i = 0; i < SIZE; i++) {
      this._window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1))
      let reversed = 0
      for (let bit = 0; bit < 9; bit++) reversed = (reversed << 1) | ((i >> bit) & 1)
      this._reverse[i] = reversed
    }
    for (let i = 0; i < SIZE / 2; i++) {
      const phase = 2 * Math.PI * i / SIZE
      this._cos[i] = Math.cos(phase)
      this._sin[i] = Math.sin(phase)
    }

    const upper = Math.min(3600, this._rate * 0.46)
    this._bands = Array.from({ length: SPECTRUM_BAR_COUNT }, (_, i) => {
      const edge = fraction => 80 * Math.pow(upper / 80, fraction)
      const start = Math.max(1, Math.round(edge(i / SPECTRUM_BAR_COUNT) * SIZE / this._rate))
      const end = Math.max(start + 1, Math.round(edge((i + 1) / SPECTRUM_BAR_COUNT) * SIZE / this._rate))
      return [start, Math.min(SIZE / 2, end)]
    })
  }

  push(pcm) {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const count = Math.floor(pcm.byteLength / 2)
    let squares = 0
    for (let i = 0; i < count; i++) {
      const sample = view.getInt16(i * 2, true) / 32768
      squares += sample * sample
      this._partialSum += sample
      if (++this._partialCount === this._stride) {
        this._ring[this._cursor] = this._partialSum / this._stride
        this._cursor = (this._cursor + 1) % SIZE
        this._partialSum = 0
        this._partialCount = 0
      }
    }

    // Hann window and bit-reversed loading of the most recent 512 samples.
    for (let i = 0; i < SIZE; i++) {
      this._real[this._reverse[i]] = this._ring[(this._cursor + i) % SIZE] * this._window[i]
      this._imag[this._reverse[i]] = 0
    }

    // In-place radix-2 FFT, with precomputed twiddles and reusable buffers.
    for (let span = 2; span <= SIZE; span *= 2) {
      const half = span / 2
      const step = SIZE / span
      for (let base = 0; base < SIZE; base += span) {
        for (let j = 0; j < half; j++) {
          const a = base + j
          const b = a + half
          const re = this._real[b] * this._cos[j * step] + this._imag[b] * this._sin[j * step]
          const im = this._imag[b] * this._cos[j * step] - this._real[b] * this._sin[j * step]
          this._real[b] = this._real[a] - re
          this._imag[b] = this._imag[a] - im
          this._real[a] += re
          this._imag[a] += im
        }
      }
    }

    const peaks = this._bands.map(([start, end]) => {
      let peak = 0
      for (let i = start; i < end; i++) {
        const energy = this._real[i] ** 2 + this._imag[i] ** 2
        if (energy > peak) peak = energy
      }
      return peak
    })
    const maximum = Math.max(...peaks)
    // Smooth independently per band: crisp onset, less jitter between speech frames.
    const bands = peaks.map((peak, i) => {
      const target = maximum > 0 ? Math.sqrt(Math.max(0, peak / maximum - 0.025) / 0.975) : 0
      const previous = this._display[i]
      const response = target > previous ? 0.55 : 0.3
      return (this._display[i] = previous + (target - previous) * response)
    })
    return { rms: count ? Math.sqrt(squares / count) : 0, bands }
  }
}
