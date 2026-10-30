import {
  MatrixSignal,
  MatrixRenderer,
  MatrixHoverIntent,
  contour,
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

  return {
    dots,
    setSourceRGBA: (...values) => { color = values },
    arc: (x, y, r) => dots.push({ x, y, r, color }),
    fill() {},
    scale() {}
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

test('final HUD dimensions and angular contour', () => {
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

  for (const width of [164, 136]) {
    const g = r._grid(width)
    expectEqual(g.cols, width === 164 ? 46 : 38)
    expectEqual(g.edge.length, g.cols * 11)
    expectEqual(g.glyph.reduce((a, b) => a + b, 0), 63)

    const lit = []
    for (let i = 0; i < 506; i++) {
      if (g.glyph[i]) {
        lit.push(g.xy[2 * i])
      }
    }
    expectTruthy(Math.max(...lit) - Math.min(...lit) > 85)
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
    r.paint(ctx(), width, MATRIX_HEIGHT, s)
    const grid = r._grid(width)
    const center = grid.strength[Math.floor(grid.cols / 2)]

    expectTruthy(center > 0)
    expectTruthy(grid.strength[0] < center * .02)
    expectTruthy(grid.strength[grid.cols - 1] < center * .02)
    expectTruthy(grid.strength[2] < center * .4)
    expectTruthy(grid.strength[grid.cols - 3] < center * .4)
    expectTruthy(grid.edge[5] > 0)
    expectEqual(grid.taper[0], 0)
    expectEqual(grid.taper[grid.cols - 1], 0)
    expectTruthy(grid.taper[Math.floor(grid.cols / 2)] > .99)
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
  s.reset()
  expectEqual(s.time, 0)
  expectEqual(s.goal, 0)
})

test('a new recording clears cached phosphor from previous session', () => {
  const s = signal()
  const r = new MatrixRenderer()

  r.paint(ctx(), 164, 40, s, 0)
  const grid = r._grid(164)
  expectTruthy(grid.tail.some(x => x > 0))

  r.reset()
  expectTruthy(grid.tail.every(x => x === 0))
  expectTruthy(grid.head.every(x => x === 0))
})

test('same dot count at 1x and 2x; single contraction dims dots', () => {
  const s = signal()
  const r = new MatrixRenderer()
  const a = ctx()
  const b = ctx()
  const c = ctx()

  expectEqual(r.paintSurface(a, 164, 40, 164, s), r.paintSurface(b, 328, 80, 164, s))
  r.paint(c, 164, 40, s, 0, 1)

  const light = o => o.dots.reduce((n, d) => n + d.color[3], 0)
  expectTruthy(light(c) < light(a))

  r.clear()
  expectEqual(r.cache.size, 0)
})

await run()
