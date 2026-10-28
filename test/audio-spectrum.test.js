import { AudioSpectrum, SPECTRUM_BAR_COUNT } from '../host/audio-spectrum.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

function pcm(rate, frequency, amplitude = 0.15) {
  const count = rate / 20
  const bytes = new Uint8Array(count * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < count; i++) {
    const value = Math.round(32767 * amplitude * Math.sin(2 * Math.PI * frequency * i / rate))
    view.setInt16(i * 2, value, true)
  }
  return bytes
}

test('silence has zero RMS and frequency levels', () => {
  const output = new AudioSpectrum(16000).push(new Uint8Array(1600))
  expectEqual(output.bands.length, SPECTRUM_BAR_COUNT)
  expectEqual(output.rms, 0)
  expectTruthy(output.bands.every(level => level === 0))
})

test('bands respond to pitch rather than scrolling an RMS history', () => {
  const low = new AudioSpectrum(16000).push(pcm(16000, 300))
  const high = new AudioSpectrum(16000).push(pcm(16000, 2400))
  const peak = values => values.indexOf(Math.max(...values))
  expectTruthy(peak(low.bands) < peak(high.bands), 'higher pitch should activate higher bands')
  expectTruthy(low.rms > 0 && high.rms > 0)
})

test('all audio-quality presets yield bounded frequency levels', () => {
  for (const rate of [8000, 12000, 16000, 24000, 48000]) {
    const analyzer = new AudioSpectrum(rate)
    for (let i = 0; i < 4; i++) {
      const frame = analyzer.push(pcm(rate, 440))
      expectTruthy(frame.rms > 0)
      expectEqual(frame.bands.length, SPECTRUM_BAR_COUNT)
      expectTruthy(frame.bands.every(level => Number.isFinite(level) && level >= 0 && level <= 1))
    }
  }
})

test('analysis leaves captured PCM untouched', () => {
  const input = pcm(16000, 440)
  const original = new Uint8Array(input)
  new AudioSpectrum(16000).push(input)
  expectTruthy(input.every((value, i) => value === original[i]))
})

await run()
