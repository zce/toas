import { WaveformNormalizer } from '../ui/waveform.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('silence and sub-threshold input remain flat', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 30; i++) {
    expectEqual(meter.push(0), 0)
    expectEqual(meter.push(0.00005), 0)
    expectEqual(meter.push(0.0008), 0)
  }
  expectEqual(meter._reference, null)
  expectEqual(meter.push(NaN), 0)
  expectEqual(meter.push(Infinity), 0)
})

test('quiet microphones produce visible bars immediately', () => {
  const meter = new WaveformNormalizer()
  const initial = meter.push(0.002)
  expectTruthy(initial > 0.12 && initial < 0.25)
  for (let i = 0; i < 20; i++) expectEqual(meter.push(0.002), initial)
})

test('quiet ambient input is suppressed and near-threshold noise is subdued', () => {
  const meter = new WaveformNormalizer()
  expectEqual(meter.push(0.0004), 0)
  expectTruthy(meter.push(0.0011) < 0.06)
})

test('successively louder peaks remain distinct', () => {
  const meter = new WaveformNormalizer()
  const a = meter.push(0.05)
  const b = meter.push(0.1)
  const c = meter.push(0.2)
  expectTruthy(a + 0.06 < b)
  expectTruthy(b + 0.03 < c)
  expectTruthy(c < 0.9)
})

test('steady loud speech retains headroom', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 30; i++) {
    const level = meter.push(0.2)
    expectTruthy(level > 0.4 && level < 0.7)
  }
})

test('loud and quiet speech retain visible contrast', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 15; i++) meter.push(0.12)
  const quiet = meter.push(0.05)
  const loud = meter.push(0.2)
  expectTruthy(loud - quiet > 0.2)
})

test('sensitivity recovers when microphone gain drops', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 15; i++) meter.push(0.12)
  const initial = meter.push(0.002)
  for (let i = 0; i < 9; i++) meter.push(0.002)
  const recovered = meter.push(0.002)
  expectTruthy(recovered > initial + 0.1)
  expectTruthy(recovered > 0.12)
})

test('brief quiet windows do not trigger fast recovery', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 10; i++) meter.push(0.2)
  meter.push(0.002)
  meter.push(0.002)
  expectEqual(meter._lowFrames, 2)
  meter.push(0.2)
  expectEqual(meter._lowFrames, 0)
  expectTruthy(meter._reference > 0.14)
})

test('digital silence does not change the adapted reference', () => {
  const meter = new WaveformNormalizer()
  meter.push(0.2)
  for (let i = 0; i < 30; i++) expectEqual(meter.push(0), 0)
  expectTruthy(meter._reference >= 0.2)
})

test('one very loud peak does not permanently fill the waveform', () => {
  const meter = new WaveformNormalizer()
  meter.push(0.002)
  expectTruthy(meter.push(1) < 0.9)
  for (let i = 0; i < 40; i++) meter.push(0.12)
  expectTruthy(meter.push(0.12) < 0.7)
})

test('finite levels remain within display bounds', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i <= 10000; i++) {
    const amplitude = i % 3 ? (i % 97) / 97 : 0
    const level = meter.push(amplitude)
    expectTruthy(level >= 0 && level < 1)
  }
})

test('reset starts a fresh recording without previous gain', () => {
  const meter = new WaveformNormalizer()
  const initial = meter.push(0.002)
  for (let i = 0; i < 40; i++) meter.push(0.12)
  meter.reset()
  expectEqual(meter.push(0.002), initial)
})

test('quiet surroundings make very low microphone levels visible', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 10; i++) expectEqual(meter.push(0.0002), 0)
  expectTruthy(meter._noise < 0.0003)
  expectTruthy(meter.push(0.002) > 0.25)
})

test('low ambient energy stays flat without hiding louder speech', () => {
  const meter = new WaveformNormalizer()
  const ambient = [0.0006, 0.001, 0.0006, 0.0004, 0.0003, 0.001, 0.0016, 0.0015]
  const ambientHeights = ambient.map(level => meter.push(level))
  expectTruthy(ambientHeights.every(height => height < 0.1))
  const speechLike = [0.01, 0.0074, 0.0074, 0.0137, 0.0091]
  expectTruthy(speechLike.map(level => meter.push(level)).every(height => height > 0.4))
})

test('an isolated loud spike does not permanently raise the background estimate', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 10; i++) meter.push(0.0004)
  const before = meter._noise
  meter.push(0.2)
  expectEqual(meter._noise, before)
  meter.push(0.0005)
  expectTruthy(meter._noise < 0.0005)
})

test('quiet microphone sensitivity is unchanged by high-level compression', () => {
  const meter = new WaveformNormalizer()
  const quiet = meter.push(0.002)
  expectTruthy(quiet > 0.12 && quiet < 0.25)
  expectEqual(meter.push(0), 0)
  expectEqual(meter.push(0.002), quiet)
})

test('sustained, dense speech keeps visual headroom without flattening its variation', () => {
  const meter = new WaveformNormalizer()
  // Representative 100 ms RMS windows from a long, dense spoken phrase.
  const frames = [0.0129, 0.0133, 0.0059, 0.0098, 0.007, 0.0083, 0.0093, 0.012]
  for (let i = 0; i < 20; i++) meter.push(0.01)
  const levels = frames.map(frame => meter.push(frame))
  expectTruthy(Math.max(...levels) < 0.60)
  expectTruthy(Math.max(...levels) - Math.min(...levels) > 0.1)
})

await run()
