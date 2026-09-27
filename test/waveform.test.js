import { WaveformNormalizer } from '../ui/waveform.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('silence and sub-threshold input remain flat', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 30; i++) {
    expectEqual(meter.push(0), 0)
    expectEqual(meter.push(0.00005), 0)
  }
  expectEqual(meter.push(NaN), 0)
  expectEqual(meter.push(Infinity), 0)
})

test('quiet microphones produce visible bars immediately', () => {
  const meter = new WaveformNormalizer()
  const initial = meter.push(0.002)
  expectTruthy(initial > 0.5 && initial < 0.7)
  for (let i = 0; i < 20; i++) expectEqual(meter.push(0.002), initial)
})

test('very quiet speech previously below the noise floor remains visible', () => {
  const meter = new WaveformNormalizer()
  expectTruthy(meter.push(0.0004) > 0.25)
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
  expectTruthy(recovered > initial + 0.15)
  expectTruthy(recovered > 0.2)
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

await run()
