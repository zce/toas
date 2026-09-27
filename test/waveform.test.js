import { WaveformActivityGate, WaveformNormalizer } from '../ui/waveform.js'
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

// The activity gate is intentionally separate from the normalizer: the
// normalizer's pure amplitude behavior must not depend on visual activity.
function visualFrames(values) {
  const normalizer = new WaveformNormalizer()
  const gate = new WaveformActivityGate()
  const bars = Array(8).fill(0)
  return values.map(rms => {
    const next = gate.push(normalizer.push(rms))
    if (!gate.active && !gate.pending) normalizer.resetGain()
    if (gate.active) {
      bars.unshift(next)
      bars.length = 8
    } else {
      bars.fill(0)
    }
    return { active: gate.active, bars: [...bars], level: next }
  })
}

test('one isolated startup peak leaves every bar resting', () => {
  const frames = visualFrames([0.0036, 0, 0, 0, 0])
  expectTruthy(frames.every(frame => frame.bars.every(bar => bar === 0)))
})

test('normal speech onset starts after two consecutive valid windows', () => {
  const frames = visualFrames([0, 0, 0.01, 0.012, 0.014])
  expectEqual(frames[2].active, false)
  expectEqual(frames[3].active, true)
  expectTruthy(frames[3].level > 0.3)
})

test('an unconfirmed peak does not hide the following quiet voice', () => {
  const frames = visualFrames([0.0036, 0, 0, 0.002, 0.002, 0.002])
  expectEqual(frames[0].active, false)
  expectEqual(frames[4].active, true)
  expectTruthy(frames[4].level > 0.14)
})

test('ordinary quiet room noise never starts the visual history', () => {
  const frames = visualFrames(Array.from({ length: 12 }, (_, i) => [0.0004, 0.0006, 0.0008, 0.0005][i % 4]))
  expectTruthy(frames.every(frame => !frame.active && frame.bars.every(bar => bar === 0)))
})

test('three quiet windows end an active waveform and clear all history', () => {
  const frames = visualFrames([0.01, 0.01, 0.01, 0, 0, 0])
  expectEqual(frames[2].active, true)
  expectEqual(frames[5].active, false)
  expectTruthy(frames[5].bars.every(bar => bar === 0))
})

test('brief natural speech valleys do not toggle recording activity', () => {
  const frames = visualFrames([0.01, 0.01, 0, 0.01])
  expectEqual(frames[3].active, true)
})

test('the gate reset clears an unfinished onset and activity state', () => {
  const gate = new WaveformActivityGate()
  expectEqual(gate.push(0.18), 0)
  expectEqual(gate.pending, true)
  gate.reset()
  expectEqual(gate.active, false)
  expectEqual(gate.pending, false)
  expectEqual(gate.push(0.2), 0)
  expectTruthy(gate.push(0.2) > 0.14)
  expectEqual(gate.active, true)
  gate.reset()
  expectEqual(gate.active, false)
})

await run()
