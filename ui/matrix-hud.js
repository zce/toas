// Final v8.7: compact 46x11 dot plate, mirrored angular braid, phosphor.
export const RECORD_WIDTH = 164
export const PROCESS_WIDTH = 136
export const MATRIX_HEIGHT = 40
export const MATRIX_STEP = 3.5
export const MATRIX_FPS = 30

const COLS = 46
const ROWS = 11
const HISTORY = 64
const TAU = Math.PI * 2

const rates = [.55, .85, 1.25, 1.65]
const spatial = [1.4, 2.4, 3.8, 5.6]
const coeff = [.32, .20, .13, .08]

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const smooth = x => {
  const t = clamp(x)
  return t * t * (3 - 2 * t)
}
const follow = (v, to, dt, tau) => v + (to - v) * (1 - Math.exp(-dt / tau))

export const contour = p => 2 / Math.PI * Math.asin(Math.sin(p))

export class MatrixSignal {
  constructor() {
    this.a = new Float32Array(HISTORY)
    this.b = new Float32Array(HISTORY)
    this.reset()
  }

  reset() {
    this.a.fill(0)
    this.b.fill(0)

    this.head = 0
    this.time = 0
    this.goal = 0
    this.voice = 0
    this.peak = -38
    this.room = -64
    this.processMix = 0
    this.phase = [.1, 1.7, 3.3, 4.6]
  }

  pushRms(rms) {
    const db = 20 * Math.log10(Math.max(1e-6, Number.isFinite(rms) ? rms : 0))

    // The old per-utterance normalization amplified even tiny noises to
    // near full scale. Keep a real noise gate and a bounded 23dB display
    // range; adapt slowly to microphone gain, never to a single loud syllable.
    this.room = follow(this.room, db, .1, db < this.room ? .3 : 12)

    if (db > this.room + 10) {
      this.peak = follow(this.peak, db, .1, db > this.peak ? .3 : 4)
    }

    const lower = Math.max(this.room + 11, this.peak - 25)
    const level = clamp((db - lower) / Math.max(23, this.peak + 2 - lower))
    this.goal = .85 * smooth(level)

    this.a[this.head] = this.goal
    this.b[this.head] = this.goal * .86
    this.head = (this.head + 1) % HISTORY
  }

  past(history, age) {
    const p = clamp(age, 0, HISTORY - 2)
    const i = Math.floor(p)
    const f = p - i
    const a = (this.head - 1 - i + HISTORY) % HISTORY
    const b = (a - 1 + HISTORY) % HISTORY

    return history[a] * (1 - f) + history[b] * f
  }

  advance(dt, mode) {
    if (!Number.isFinite(dt) || dt <= 0) {
      return
    }

    const h = Math.min(.08, dt)
    const voice = mode === 'recording'
    const busy = mode === 'busy'

    this.time += h

    const target = voice ? this.goal : 0
    this.voice = follow(this.voice, target, h, target > this.voice ? .13 : .22)

    const rate = voice ? 1 : busy ? .15 : 0
    const speed = this.voice * .35 + .42

    for (let i = 0; i < 4; i++) {
      this.phase[i] += h * TAU * rates[i] * speed * rate
    }

    this.processMix = follow(this.processMix, busy ? 1 : 0, h, .22)
  }
}

export class MatrixHoverIntent {
  constructor() {
    this.reset()
  }

  reset(x = null, y = null) {
    this.active = false
    this.x = x
    this.y = y
  }

  move(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    if (this.x === null || this.y === null) {
      this.x = x
      this.y = y
    } else if (Math.hypot(x - this.x, y - this.y) >= 3) {
      this.active = true
    }
  }
}

const letters = {
  C: ['0111', '1000', '1000', '1000', '0111'],
  A: ['0110', '1001', '1111', '1001', '1001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  E: ['1111', '1000', '1110', '1000', '1111'],
  L: ['1000', '1000', '1000', '1000', '1111']
}

function geometry(width) {
  const cols = Math.max(2, Math.floor(width / MATRIX_STEP))
  const size = cols * ROWS
  const xy = new Float32Array(size * 2)
  const edge = new Float32Array(size)
  const glyph = new Uint8Array(size)

  const ox = width / 2 - (cols - 1) * MATRIX_STEP / 2
  const oy = MATRIX_HEIGHT / 2 - (ROWS - 1) * MATRIX_STEP / 2

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < ROWS; y++) {
      const n = x * ROWS + y
      const px = ox + x * MATRIX_STEP
      const py = oy + y * MATRIX_STEP
      const dx = Math.max(0, Math.abs(px - width / 2) - (width - MATRIX_HEIGHT) / 2)
      const signed = MATRIX_HEIGHT / 2 - Math.hypot(dx, py - MATRIX_HEIGHT / 2)

      xy[n * 2] = px
      xy[n * 2 + 1] = py
      edge[n] = smooth((signed - 1.1) / 4.8) *
        (1 - .55 * smooth((Math.abs(py - MATRIX_HEIGHT / 2) / (MATRIX_HEIGHT / 2) - .37) / .63))
    }
  }

  if (cols >= 29) {
    const left = Math.floor((cols - 29) / 2)
    const top = Math.floor((ROWS - 5) / 2)

    for (let k = 0; k < 6; k++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 4; x++) {
          if (letters['CANCEL'[k]][y][x] === '1') {
            glyph[(left + k * 5 + x) * ROWS + (top + y)] = 1
          }
        }
      }
    }
  }

  return {
    width,
    cols,
    xy,
    edge,
    glyph,
    head: new Float32Array(size),
    tail: new Float32Array(size),
    path: [new Float32Array(cols), new Float32Array(cols)],
    strength: [new Float32Array(cols), new Float32Array(cols)]
  }
}

const base = [135 / 255, 192 / 255, 1]
const core = [229 / 255, 242 / 255, 1]
const amber = [216 / 255, 154 / 255, 121 / 255]

export class MatrixRenderer {
  constructor() {
    this.cache = new Map()
    this.temporary = null
  }

  _grid(w) {
    const width = Math.max(20, Math.round(w))

    if (width === RECORD_WIDTH || width === PROCESS_WIDTH) {
      if (!this.cache.has(width)) {
        this.cache.set(width, geometry(width))
      }
      return this.cache.get(width)
    }

    if (this.temporary?.width !== width) {
      this.temporary = geometry(width)
    }
    return this.temporary
  }

  paint(cr, width, height, model, hover = 0, exit = 0) {
    if (width <= 0 || height <= 0) {
      return 0
    }

    const grid = this._grid(width)
    const { xy, edge, glyph, path, strength } = grid
    const rec = 1 - model.processMix
    const work = model.processMix
    const t = model.time

    // The fixed-size HUD only has 11 rows: keep the main wave within
    // about 2.4 rows per side, leaving the bright trace room to breathe.
    const amp = .30 + .15 * (.5 + .5 * Math.sin(t * TAU / 5.5)) +
      1.95 * Math.pow(model.voice, .72)
    const carrier = t * TAU * .17
    const mid = (ROWS - 1) / 2

    // Compute the two strands once per column, not once per dot.
    for (let x = 0; x < grid.cols; x++) {
      const u = x / (grid.cols - 1)
      const ends = Math.min(smooth(u * 7), smooth((1 - u) * 7))

      for (let k = 0; k < 2; k++) {
        const history = k === 0 ? model.a : model.b
        const phases = model.phase
        const v = model.past(history, 1 + u * 13)
        let spread = 0

        for (let j = 0; j < 4; j++) {
          spread += coeff[j] * Math.sin(TAU * spatial[j] * u - phases[j]) * v
        }

        path[k][x] = mid + (k === 0 ? -1 : 1) * ends *
          (amp * contour(TAU * 1.55 * u - carrier + (k === 1 ? .12 : 0)) +
            spread * .68) * rec
        strength[k][x] = rec * (.65 + .45 * Math.sqrt(model.voice)) * (.64 + .36 * ends)
      }
    }

    const headKeep = Math.exp(-1 / (MATRIX_FPS * .12))
    const tailKeep = Math.exp(-1 / (MATRIX_FPS * .38))
    const beam = (((t * .64) % 1.42) - .19) * grid.width
    const morph = smooth(hover)
    let count = 0

    // Each existing dot participates in the recording, processing, and
    // CANCEL states. No separate text or stroke layer is drawn.
    for (let i = 0; i < edge.length; i++) {
      const mask = edge[i]
      if (mask <= .015) {
        continue
      }

      const x = xy[2 * i]
      const y = xy[2 * i + 1]
      const col = Math.floor(i / ROWS)
      const row = i % ROWS

      const da = row - path[0][col]
      const db = row - path[1][col]
      const one = Math.exp(-da * da / .63) * strength[0][col]
      const two = Math.exp(-db * db / .63) * strength[1][col]
      const current = 1 - (1 - clamp(one)) * (1 - clamp(two))

      grid.head[i] = Math.max(grid.head[i] * headKeep, current * .75)
      grid.tail[i] = Math.max(grid.tail[i] * tailKeep, current * .84)

      const glow = Math.max(current, grid.head[i], grid.tail[i] * .33)
      const pass = Math.exp(-Math.pow((x - beam) / 10, 2)) * 1.35
      const center = Math.exp(-Math.pow((y - MATRIX_HEIGHT / 2) / 4.7, 2))
      const working = clamp((.10 + .12 *
        Math.pow(Math.sin(TAU * 1.25 * x / grid.width - carrier), 2) + pass) * center)

      let power = (glow * rec + working * work) * (1 - .58 * smooth(exit))
      power = power * (1 - morph) + (glyph[i] ? .98 : .015) * morph

      const val = clamp(power)
      const fresh = current / (glow + .0001)
      const radius = MATRIX_STEP * (.24 + .20 * Math.pow(val, .62))
      const alpha = (.077 * (1 - .65 *
        smooth(Math.abs(y - MATRIX_HEIGHT / 2) / (MATRIX_HEIGHT / 2))) +
        .923 * Math.pow(val, .78)) * mask

      if (alpha < .009) {
        continue
      }

      const bright = Math.min(.97, val * val * 1.15) * (.34 + .66 * clamp(fresh))
      const warning = morph * (glyph[i] ? .88 : .10)

      const red = (base[0] * (1 - bright) + core[0] * bright) *
        (1 - warning) + amber[0] * warning
      const green = (base[1] * (1 - bright) + core[1] * bright) *
        (1 - warning) + amber[1] * warning
      const blue = (base[2] * (1 - bright) + core[2] * bright) *
        (1 - warning) + amber[2] * warning

      if (val > .08) {
        cr.setSourceRGBA(red, green, blue, .12 * val * val * mask)
        cr.arc(x, y, radius * 1.7, 0, TAU)
        cr.fill()
      }

      cr.setSourceRGBA(red, green, blue, alpha)
      cr.arc(x, y, radius, 0, TAU)
      cr.fill()
      count++
    }

    return count
  }

  paintSurface(cr, pw, ph, lw, model, hover = 0, exit = 0) {
    if (pw <= 0 || ph <= 0 || lw <= 0) {
      return 0
    }

    const scale = pw / lw
    cr.scale(scale, scale)
    return this.paint(cr, pw / scale, ph / scale, model, hover, exit)
  }

  reset() {
    for (const grid of this.cache.values()) {
      grid.head.fill(0)
      grid.tail.fill(0)
    }

    if (this.temporary) {
      this.temporary.head.fill(0)
      this.temporary.tail.fill(0)
    }
  }

  clear() {
    this.cache.clear()
    this.temporary = null
  }
}
