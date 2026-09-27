import { WaveformNormalizer } from '../ui/waveform.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('silence and levels beneath the noise floor remain flat', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 30; i++) {
    expectEqual(meter.push(0), 0)
    expectEqual(meter.push(0.0005), 0)
  }
  expectEqual(meter.push(NaN), 0)
  expectEqual(meter.push(Infinity), 0)
})

test('quiet speech remains visible and gains sensitivity over time', () => {
  const meter = new WaveformNormalizer()
  const initial = meter.push(0.002)
  for (let i = 0; i < 24; i++) meter.push(0.002)
  const adapted = meter.push(0.002)
  expectTruthy(initial > 0.05)
  expectTruthy(adapted > 0.4)
  expectTruthy(adapted > initial)
})

test('loud speech has headroom instead of pinning every bar', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 24; i++) meter.push(0.002)
  const first = meter.push(0.12)
  const steady = meter.push(0.12)
  expectTruthy(first > 0.6 && first < 1)
  expectTruthy(steady > 0.6 && steady < 1)
})

test('sensitivity recovers after microphone volume drops', () => {
  const meter = new WaveformNormalizer()
  for (let i = 0; i < 10; i++) meter.push(0.12)
  const initial = meter.push(0.002)
  for (let i = 0; i < 35; i++) meter.push(0.002)
  expectTruthy(meter.push(0.002) > initial)
})

test('reset starts a fresh recording without carrying the previous gain', () => {
  const meter = new WaveformNormalizer()
  const first = meter.push(0.002)
  for (let i = 0; i < 40; i++) meter.push(0.12)
  meter.reset()
  expectEqual(meter.push(0.002), first)
})

await run()
