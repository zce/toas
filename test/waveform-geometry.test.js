import { drawWaveform, waveformBars, WAVEFORM_WIDTH, WAVEFORM_HEIGHT } from '../ui/waveform-geometry.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('strokes and spacing stay uniform across fractional scales', () => {
  for (const [width, height] of [[50, 20], [63, 25], [75, 30], [100, 40], [125, 50]]) {
    const bars = waveformBars(width, height, Array.from({ length: 13 }, (_, i) => i / 12))
    expectEqual(bars.length, 13)
    expectTruthy(bars.every(bar => bar.stroke === bars[0].stroke))
    expectTruthy(bars.every((bar, i) => i === 0 || bar.x - bars[i - 1].x === bars[1].x - bars[0].x))
    expectTruthy(bars.every(bar => bar.x - bar.stroke / 2 >= 0 && bar.x + bar.stroke / 2 <= width))
    expectTruthy(bars.every(bar => bar.top - bar.stroke / 2 >= 0 && bar.bottom + bar.stroke / 2 <= height))
  }
})

test('waveform remains within the baseline capsule geometry', () => {
  expectTruthy(WAVEFORM_WIDTH <= 8 * 4 + 7 * 3)
  expectEqual(WAVEFORM_HEIGHT, 20)
})

test('invalid audio levels are safe and height remains responsive', () => {
  const bars = waveformBars(50, 20, [NaN, Infinity, -1, 0, 0.5, 1])
  expectTruthy(bars.every(bar => Number.isFinite(bar.top) && Number.isFinite(bar.bottom)))
  expectEqual(bars[0].bottom - bars[0].top, bars[1].bottom - bars[1].top)
  expectTruthy(bars[4].bottom > bars[3].bottom)
})

test('GJS Cairo drawing path actually strokes every bar', () => {
  const calls = []
  const cr = {
    setLineCap: value => calls.push(['cap', value]),
    setLineWidth: value => calls.push(['width', value]),
    setSourceRGBA: (...values) => calls.push(['color', ...values]),
    moveTo: (x, y) => calls.push(['move', x, y]),
    lineTo: (x, y) => calls.push(['line', x, y]),
    stroke: () => calls.push(['stroke'])
  }

  // Deliberately expose only real GJS Cairo methods. Snake-case calls would throw.
  drawWaveform(cr, 50, 20, Array.from({ length: 13 }, (_, index) => index / 12), 'round')
  expectEqual(calls.filter(call => call[0] === 'stroke').length, 13)
  expectEqual(calls.filter(call => call[0] === 'width').length, 13)
  expectTruthy(calls.filter(call => call[0] === 'width').every(call => call[1] === 2))
  expectEqual(calls[0][1], 'round')
})

test('zero-sized surface never attempts Cairo drawing', () => {
  drawWaveform({}, 0, 0, [0, 1], 'round')
})

await run()
