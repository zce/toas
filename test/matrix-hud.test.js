// Headless fake-Cairo checks for the actual dot renderer. A typo like
// set_line_width() fails here before it can break GNOME Shell's overlay.
import { paintMatrix, paintMatrixSurface, recordingLevel, MatrixHoverIntent, RECORD_WIDTH, PROCESS_WIDTH, MATRIX_HEIGHT, MATRIX_FPS } from '../ui/matrix-hud.js'
import { expectTruthy, expectEqual, run, test } from './harness.js'

function paint(mode, level = .3, hover = 0, width = RECORD_WIDTH) {
  const colors = []
  let count = 0
  const cr = {
    setSourceRGBA: (...v) => colors.push(v),
    arc: () => {},
    fill: () => { count++ }
  }
  const actual = paintMatrix(cr, width, MATRIX_HEIGHT, mode, 1.5, level, hover)
  return { colors, count, actual }
}

test('matrix paints with GJS Cairo and covers recording capsule', () => {
  const a = paint('recording')
  expectTruthy(a.count > 200)
  expectEqual(a.count, a.actual)
  expectTruthy(a.colors.every(c => c.length === 4 && c[3] > 0 && c[3] <= 1))
})

test('processing is narrower and retains a full dot field', () => {
  const a = paint('recording')
  const b = paint('busy', .3, 0, PROCESS_WIDTH)
  expectTruthy(b.count > 100)
  expectTruthy(a.count > b.count)
})

test('recording responds to volume without extra sample analysis', () => {
  const a = paint('recording', 0)
  const b = paint('recording', 1)
  const energy = x => x.colors.reduce((s,c) => s + c[3], 0)
  expectTruthy(energy(b) > energy(a))
})

test('CANCEL is an amber dot glyph only while hovered', () => {
  const ordinary = paint('recording', .3, 0)
  const hovered = paint('recording', .3, 1)
  expectEqual(ordinary.colors.filter(c => c[0] === .86).length, 0)
  expectTruthy(hovered.colors.filter(c => c[0] === .86).length > 30)
})

test('safe when allocated zero area; rendering cap remains 15 fps', () => {
  expectEqual(paintMatrix({},0,0,'recording',0,0,0),0)
  expectEqual(MATRIX_FPS,15)
})

test('HUD fits the compact dimensions, with a centered CANCEL word', () => {
  expectEqual(RECORD_WIDTH, 174)
  expectEqual(PROCESS_WIDTH, 116)
  expectEqual(MATRIX_HEIGHT, 38)
  const amber = []
  let color = 0
  const cr = {
    setSourceRGBA: (red) => { color = red },
    arc: (x, y) => { if (color === .86) amber.push([x, y]) },
    fill: () => {}
  }
  paintMatrix(cr, RECORD_WIDTH, MATRIX_HEIGHT, 'recording', 1, .4, 1)
  expectTruthy(amber.length > 30)
  expectTruthy(amber.every(([x, y]) =>
    x > RECORD_WIDTH / 2 - 40 && x < RECORD_WIDTH / 2 + 40 &&
    y > MATRIX_HEIGHT / 2 - 9 && y < MATRIX_HEIGHT / 2 + 9))
})

test('fixed RMS mapping retains loudness differences without automatic saturation', () => {
  const values = [.0025, .004, .008, .016, .032, .064].map(recordingLevel)
  expectTruthy(values.every((v, i) => v > 0 && v < 1 && (i === 0 || v > values[i - 1])))
  expectEqual(recordingLevel(0), 0)
  expectEqual(recordingLevel(NaN), 0)
  expectEqual(recordingLevel(Infinity), 0)
  expectEqual(recordingLevel(.5), 1)
})

test('CANCEL needs a fresh pointer movement after every run', () => {
  const intent = new MatrixHoverIntent()
  intent.reset(100, 200)
  expectEqual(intent.active, false)
  intent.move(100, 200) // Shell may emit motion on actor appearance
  intent.move(101, 201)
  expectEqual(intent.active, false)
  intent.move(105, 201)
  expectEqual(intent.active, true)
  intent.reset(105, 201) // hide then reopen under unchanged pointer
  expectEqual(intent.active, false)
  intent.move(105, 201)
  expectEqual(intent.active, false)
  intent.move(110, 201)
  expectEqual(intent.active, true)
  intent.reset()
  intent.move(220, 250) // first event after leaving only sets anchor
  expectEqual(intent.active, false)
  intent.move(224, 250)
  expectEqual(intent.active, true)
})

test('2x display scale does not create four times as many dots', () => {
  const makeCr = () => {
    let count = 0
    let scale = 0
    return {
      setSourceRGBA: () => {},
      arc: () => {},
      fill: () => { count++ },
      scale: value => { scale = value },
      stats: () => [count, scale]
    }
  }
  const a = makeCr()
  const b = makeCr()
  paintMatrixSurface(a, RECORD_WIDTH, MATRIX_HEIGHT, RECORD_WIDTH,
    'recording', 1, .5, 0)
  paintMatrixSurface(b, RECORD_WIDTH * 2, MATRIX_HEIGHT * 2, RECORD_WIDTH,
    'recording', 1, .5, 0)
  expectEqual(b.stats()[0], a.stats()[0])
  expectEqual(a.stats()[1], 1)
  expectEqual(b.stats()[1], 2)
  expectEqual(paintMatrixSurface({}, 0, 0, 0, 'busy', 0, 0, 0), 0)
})

await run()
