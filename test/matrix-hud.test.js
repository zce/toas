import {
  MatrixSignal,
  MatrixRenderer,
  MatrixHoverIntent,
  contour,
  HUD_HEIGHT,
  HUD_RECORD_WIDTH,
  HUD_PROCESS_WIDTH,
  HUD_EXIT_WIDTH,
  RECORD_WIDTH,
  PROCESS_WIDTH,
  MATRIX_HEIGHT,
  MATRIX_STEP,
  MATRIX_FPS
} from '../ui/matrix-hud.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const ctx = () => {
  const dots = []
  let color = []
  let scale = 1
  let tx = 0
  let ty = 0

  return {
    dots,
    setSourceRGBA: (...values) => { color = values },
    arc: (x, y, r) => dots.push({ x: x * scale + tx, y: y * scale + ty, r: r * scale, color }),
    fill() {},
    scale(x, y) {
      expectEqual(x, y, 'dot circles must not be stretched')
      scale *= x
    },
    translate(x, y) {
      tx += x * scale
      ty += y * scale
    }
  }
}

const signal = () => {
  const s = new MatrixSignal()

  for (let i = 0; i < 28; i++) {
    s.pushRms(.004 + .02 * Math.abs(Math.sin(i * .3)))
    s.advance(.1, 'recording')
  }

  return s
}

test('compact layout uses integer bounds and preserves the original design grid', () => {
  expectEqual(HUD_RECORD_WIDTH, 148)
  expectEqual(HUD_PROCESS_WIDTH, 122)
  expectEqual(HUD_HEIGHT, 36)
  expectEqual(HUD_EXIT_WIDTH, 41)
  expectEqual(RECORD_WIDTH, 164)
  expectEqual(PROCESS_WIDTH, 136)
  expectEqual(MATRIX_HEIGHT, 40)
  expectEqual(MATRIX_STEP, 3.5)
  expectEqual(MATRIX_FPS, 30)

  expectTruthy(Math.abs(contour(Math.PI / 2) - 1) < .00001)
  expectTruthy(Math.abs(contour(Math.PI)) < .00001)
})

test('CANCEL uses exactly the same grid cells at both widths', () => {
  const r = new MatrixRenderer()
  const word = [
    '.### .##. #..# .### #### #...',
    '#... #..# ##.# #... #... #...',
    '#... #### #.## #... ###. #...',
    '#... #..# #..# #... #... #...',
    '.### #..# #..# .### #### ####'
  ]
  const expected = word.flatMap((row, y) => Array.from(row).flatMap((cell, x) =>
    cell === '#' ? [[x, y]] : []))
  let previous

  for (const width of [RECORD_WIDTH, PROCESS_WIDTH]) {
    const g = r._grid(width)
    expectEqual(g.cols, width === RECORD_WIDTH ? 46 : 38)
    expectEqual(g.edge.length, g.cols * 11)

    const drawing = ctx()
    r.paint(drawing, width, MATRIX_HEIGHT, signal(), 1)
    // Select visible amber cores, not their faint glow or the blue background.
    const lit = drawing.dots.filter(d => d.color[0] > d.color[2] && d.color[3] > .2)
      .sort((a, b) => a.y - b.y || a.x - b.x)
    expectEqual(lit.length, 63)
    const left = Math.min(...lit.map(d => d.x))
    const right = Math.max(...lit.map(d => d.x))
    const top = Math.min(...lit.map(d => d.y))
    const bottom = Math.max(...lit.map(d => d.y))
    expectEqual(lit.map(d => [(d.x - left) / MATRIX_STEP, (d.y - top) / MATRIX_STEP]), expected)
    expectTruthy(Math.abs((left + right) / 2 - width / 2) <= MATRIX_STEP / 2)
    expectEqual((top + bottom) / 2, MATRIX_HEIGHT / 2)

    const centered = lit.map(d => [d.x - width / 2, d.y - MATRIX_HEIGHT / 2])
    if (previous) {
      expectEqual(centered, previous)
    }
    previous = centered
  }
})

test('recording and processing draw within one Cairo surface', () => {
  const s = signal()
  const r = new MatrixRenderer()
  const a = ctx()
  const b = ctx()

  const rec = r.paint(a, 164, 40, s)
  for (let i = 0; i < 18; i++) {
    s.advance(1 / 30, 'busy')
  }
  const proc = r.paint(b, 136, 40, s)

  expectTruthy(rec > 350 && proc > 280 && rec > proc)
  expectTruthy(a.dots.every(d => d.r > 0 && d.color[3] <= 1))
})

test('transition widths never allocate invisible off-capsule columns', () => {
  const r = new MatrixRenderer()

  for (const width of [34, 50, 80, 120, 136, 164]) {
    const g = r._grid(width)
    expectEqual(g.cols, Math.max(2, Math.floor(width / MATRIX_STEP)))
    expectTruthy(g.xy.every((v, i) => i % 2 === 1 || (v >= 0 && v <= width)))
    expectEqual(g.glyph.reduce((a, b) => a + b, 0), width >= 102 ? 63 : 0)
  }
})

test('hover changes existing dots to amber, no separate text layer', () => {
  const s = signal()
  const r = new MatrixRenderer()
  const a = ctx()
  const b = ctx()

  r.paint(a, 164, 40, s, 0)
  r.paint(b, 164, 40, s, 1)

  expectTruthy(b.dots.some(d => d.color[0] > d.color[2]))
  expectTruthy(a.dots.every(d => d.color[0] <= d.color[2]))
})

test('quiet and loud RMS differ; silence is not amplified to full', () => {
  const s = new MatrixSignal()

  for (let i = 0; i < 28; i++) {
    s.pushRms(.002)
  }
  const quiet = s.goal

  for (let i = 0; i < 28; i++) {
    s.pushRms(.02)
  }
  expectTruthy(s.goal > quiet)

  for (let i = 0; i < 60; i++) {
    s.pushRms(0)
  }
  expectTruthy(s.goal < .2)
})

test('recorded speech produces restrained bounded vertical motion', () => {
  const s = new MatrixSignal()
  const r = new MatrixRenderer()
  const cr = ctx()
  const measured = []

  for (const rms of [.0007, .002, .004, .008, .012, .02, .031, .052]) {
    for (let i = 0; i < 10; i++) {
      s.pushRms(rms)
      s.advance(.1, 'recording')
      r.paint(cr, 164, 40, s)
    }

    const grid = r._grid(164)
    const max = Math.max(...grid.path.flatMap(p => Array.from(p, x => Math.abs(x - 5))))
    measured.push(max)
  }

  expectTruthy(measured[0] < .7)
  expectTruthy(measured[2] < 1.25)
  expectTruthy(measured.at(-1) > measured[2])
  expectTruthy(Math.max(...measured) < 3)
})

test('bright trace fades before the capsule ends without clipping the dot field', () => {
  const s = signal()
  const r = new MatrixRenderer()

  for (const width of [RECORD_WIDTH, PROCESS_WIDTH]) {
    const drawing = ctx()
    r.paint(drawing, width, MATRIX_HEIGHT, s)
    const columns = [...new Set(drawing.dots.map(d => d.x))].sort((a, b) => a - b)
    const peaks = columns.map(x => Math.max(...drawing.dots.filter(d => d.x === x).map(d => d.color[3])))
    const center = Math.max(...peaks.slice(Math.floor(peaks.length / 3), Math.ceil(peaks.length * 2 / 3)))

    expectTruthy(center > .5, 'the central voice trace must remain visible')
    for (const index of [0, peaks.length - 1]) {
      expectTruthy(peaks[index] > 0, 'the quiet background must reach both ends')
      expectTruthy(peaks[index] < center * .2, 'the bright trace must fade before each end')
    }
    for (const index of [2, peaks.length - 3]) {
      expectTruthy(peaks[index] < center * .75, 'the shoulders must be dimmer than the central trace')
    }
  }
})

test('processing glow fades at both ends while CANCEL stays centered', () => {
  const s = signal()
  const r = new MatrixRenderer()

  s.processMix = 1
  const busy = ctx()
  r.paint(busy, PROCESS_WIDTH, MATRIX_HEIGHT, s)

  const grid = r._grid(PROCESS_WIDTH)
  const middle = 5
  for (const col of [0, grid.cols - 1]) {
    const dot = busy.dots.find(d => d.x === grid.xy[(col * 11 + middle) * 2] &&
      d.y === MATRIX_HEIGHT / 2)
    expectTruthy(dot)
    expectTruthy(Math.abs(dot.color[3] - .077 * grid.edge[col * 11 + middle]) < .00001)
  }

  const glyphColumns = []
  for (let col = 0; col < grid.cols; col++) {
    if (grid.glyph.slice(col * 11, col * 11 + 11).some(Boolean)) {
      glyphColumns.push(col)
    }
  }
  expectTruthy(glyphColumns[0] > 3)
  expectTruthy(glyphColumns.at(-1) < grid.cols - 4)
})

test('processing remains visibly active when motion is disabled', () => {
  const s = new MatrixSignal()
  s.processMix = 1
  const r = new MatrixRenderer()
  const cr = ctx()
  r.paint(cr, PROCESS_WIDTH, MATRIX_HEIGHT, s)

  const grid = r._grid(PROCESS_WIDTH)
  const col = Math.floor(grid.cols / 2)
  const x = grid.xy[(col * 11 + 5) * 2]
  const centerDots = cr.dots.filter(dot => dot.x === x && dot.y === MATRIX_HEIGHT / 2)

  expectTruthy(centerDots.at(-1).color[3] > .25)
})

test('pointer cancel intent and voice history reset', () => {
  const m = new MatrixHoverIntent()
  m.reset(100, 200)
  m.move(101, 200)
  expectEqual(m.active, false)

  m.move(105, 200)
  expectEqual(m.active, true)

  m.reset(105, 200)
  m.move(105, 200)
  expectEqual(m.active, false)

  const s = signal()
  for (let i = 0; i < s.history.length * 2; i++) {
    // Quiet gaps keep adaptation from treating a steady tone as room noise.
    s.pushRms(i % 2 === 0 ? 0 : .02)
  }
  const ages = [0, .5, 7, 13]
  expectTruthy(ages.some(age => s.past(age) > 0))
  s.reset()
  expectEqual(s.time, 0)
  expectEqual(s.goal, 0)
  expectEqual(ages.map(age => s.past(age)), ages.map(() => 0))
})

test('a new recording clears cached phosphor from previous session', () => {
  const s = signal()
  const r = new MatrixRenderer()
  const quiet = new MatrixSignal()
  const expected = new Map()

  for (const width of [RECORD_WIDTH, PROCESS_WIDTH]) {
    r.paint(ctx(), width, MATRIX_HEIGHT, s)
    const fresh = ctx()
    new MatrixRenderer().paint(fresh, width, MATRIX_HEIGHT, quiet)
    expected.set(width, fresh.dots)

    const stale = ctx()
    r.paint(stale, width, MATRIX_HEIGHT, quiet)
    expectTruthy(JSON.stringify(stale.dots) !== JSON.stringify(fresh.dots), 'the fixture must retain a visible old trace')
  }

  r.reset()
  for (const width of [RECORD_WIDTH, PROCESS_WIDTH]) {
    const drawing = ctx()
    r.paint(drawing, width, MATRIX_HEIGHT, quiet)
    expectEqual(drawing.dots, expected.get(width))
  }
})

test('compact surfaces preserve dot counts, spacing and centered grid bounds', () => {
  const s = signal()
  const scale = HUD_HEIGHT / MATRIX_HEIGHT

  for (const [width, designWidth] of [[HUD_RECORD_WIDTH, RECORD_WIDTH], [HUD_PROCESS_WIDTH, PROCESS_WIDTH]]) {
    const r = new MatrixRenderer()
    const original = ctx()
    const compact = ctx()
    r.paint(original, designWidth, MATRIX_HEIGHT, s, 1)
    r.paintSurface(compact, width, HUD_HEIGHT, s, 1)

    expectEqual(compact.dots.length, original.dots.length)
    const offset = (width - designWidth * scale) / 2
    for (let i = 0; i < original.dots.length; i++) {
      expectTruthy(Math.abs(compact.dots[i].x - (original.dots[i].x * scale + offset)) < .00001)
      expectTruthy(Math.abs(compact.dots[i].y - original.dots[i].y * scale) < .00001)
      expectTruthy(Math.abs(compact.dots[i].r - original.dots[i].r * scale) < .00001)
    }
    const xs = compact.dots.map(dot => dot.x)
    expectTruthy(Math.abs(Math.min(...xs) + Math.max(...xs) - width) < .00001)
  }
})

test('compact transition widths keep the dot field centered and inside the surface', () => {
  const s = signal()
  const r = new MatrixRenderer()

  for (let width = HUD_HEIGHT; width <= HUD_RECORD_WIDTH; width++) {
    const cr = ctx()
    r.paintSurface(cr, width, HUD_HEIGHT, s)
    expectTruthy(cr.dots.every(dot => dot.x >= 0 && dot.x <= width && dot.y >= 0 && dot.y <= HUD_HEIGHT))
    const xs = cr.dots.map(dot => dot.x)
    expectTruthy(Math.abs(Math.min(...xs) + Math.max(...xs) - width) < .00001)
  }
})

test('same dot count at 1x and 2x surfaces; single contraction dims dots', () => {
  const s = signal()
  const r = new MatrixRenderer()
  const a = ctx()
  const b = ctx()
  const c = ctx()

  expectEqual(r.paintSurface(a, HUD_RECORD_WIDTH, HUD_HEIGHT, s),
    r.paintSurface(b, HUD_RECORD_WIDTH * 2, HUD_HEIGHT * 2, s))
  r.paint(c, 164, 40, s, 0, 1)

  const light = o => o.dots.reduce((n, d) => n + d.color[3], 0)
  expectTruthy(light(c) < light(a))

  r.clear()
  expectEqual(r.cache.size, 0)
})

await run()
