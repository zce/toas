// Headless fake-Cairo checks for the actual dot renderer. A typo like
// set_line_width() fails here before it can break GNOME Shell's overlay.
import { paintMatrix, RECORD_WIDTH, PROCESS_WIDTH, MATRIX_HEIGHT, MATRIX_FPS } from '../ui/matrix-hud.js'
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

await run()
