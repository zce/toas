import { AudioLevelMeter } from '../ui/level-meter.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

// Exercise the meter and eight-bar history without requiring GNOME Shell.
function replay(values) {
  const meter = new AudioLevelMeter()
  const bars = Array(8).fill(0)
  return values.map(value => {
    const level = meter.push(value)
    if (meter.active) {
      bars.unshift(level)
      bars.length = 8
    } else {
      bars.fill(0)
    }
    return { level, active: meter.active, bars: [...bars] }
  })
}

test('silence and quiet room noise leave the waveform at rest', () => {
  const frames = replay([0, 0, 0.0002, 0.0007, 0.001, 0.0015, 0, 0.0006])
  expectTruthy(frames.every(frame => !frame.active && frame.bars.every(value => value === 0)))
})

test('an isolated startup peak does not scroll across the waveform', () => {
  const frames = replay([0.00357, 0, 0, 0, 0.0004])
  expectTruthy(frames.every(frame => !frame.active && frame.bars.every(value => value === 0)))
})

test('sustained low-level input is visible after the second window', () => {
  const frames = replay([0.002, 0.002, 0.002, 0.002])
  expectEqual(frames[0].level, 0)
  expectTruthy(frames[1].level > 0.1 && frames[1].level < 0.25)
  expectEqual(frames[3].active, true)
})

test('sustained loud input leaves display headroom', () => {
  const frames = replay(Array(15).fill(0.12))
  expectTruthy(frames.slice(2).every(frame => frame.level > 0.35 && frame.level < 0.7))
})

test('changes in input level remain distinguishable', () => {
  const frames = replay([0.01, 0.01, 0.01, 0.005, 0.012, 0.025])
  expectTruthy(frames[5].level > frames[3].level + 0.15)
  expectTruthy(frames[5].level < 0.85)
})

test('brief pauses retain activity without inventing sound', () => {
  const frames = replay([0.01, 0.01, 0, 0, 0.012])
  expectEqual(frames[2].level, 0)
  expectEqual(frames[4].active, true)
  expectTruthy(frames[4].level > 0.4)
})

test('three quiet windows return all eight bars to rest', () => {
  const frames = replay([0.01, 0.01, 0.01, 0, 0, 0])
  expectEqual(frames[4].active, true)
  expectEqual(frames[5].active, false)
  expectTruthy(frames[5].bars.every(value => value === 0))
})

test('visual sensitivity recovers after a sustained microphone gain drop', () => {
  const meter = new AudioLevelMeter()
  for (let i = 0; i < 10; i++) meter.push(0.12)
  const levels = Array.from({ length: 8 }, () => meter.push(0.002))
  expectTruthy(levels.at(-1) > 0.1 && levels.at(-1) < 0.3)
})

test('invalid input is silent without breaking subsequent levels', () => {
  const meter = new AudioLevelMeter()
  expectEqual(meter.push(NaN), 0)
  expectEqual(meter.push(Infinity), 0)
  expectEqual(meter.push(-1), 0)
  meter.push(0.01)
  expectTruthy(meter.push(0.01) > 0)
})

test('reset clears activity and does not reuse previous gain', () => {
  const meter = new AudioLevelMeter()
  meter.push(0.12)
  meter.push(0.12)
  meter.reset()
  expectEqual(meter.active, false)
  expectEqual(meter.push(0.002), 0)
  expectTruthy(meter.push(0.002) > 0.1)
})

await run()
