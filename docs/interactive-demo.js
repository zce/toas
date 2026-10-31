// A self-contained, microphone-free preview of Toas' experimental Matrix HUD.
// HUD sizing and signal geometry mirror ui/matrix-hud.js on this feature branch.
(() => {
  const root = document.querySelector('[data-interactive-demo]')
  if (!root) return
  const $ = selector => root.querySelector(selector)
  const canvas = $('[data-demo-canvas]')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const pill = $('[data-matrix-pill]')
  const status = $('[data-demo-status]')
  const detail = $('[data-demo-detail]')
  const phaseLabel = $('[data-demo-phase]')
  const output = $('[data-demo-inserted]')
  const placeholder = $('[data-demo-placeholder]')
  const modeButtons = [...root.querySelectorAll('[data-demo-mode]')]
  const replay = $('[data-demo-replay]')
  const soundButton = $('[data-demo-sound]')

  // GNOME's native surface is 36px high; its 40px design lattice is scaled
  // uniformly, preserving the original 46x11 dots and pixel CANCEL lettering.
  const DESIGN_HEIGHT = 40, HUD_HEIGHT = 36, SCALE = HUD_HEIGHT / DESIGN_HEIGHT
  const RECORD_WIDTH = 164, PROCESS_WIDTH = 136, EXIT_WIDTH = 46
  const ROWS = 11, STEP = 3.5, FPS = 30, TAU = 2 * Math.PI
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
  const smooth = v => { const x = clamp(v); return x * x * (3 - 2 * x) }
  const mix = (a, b, t) => a + (b - a) * t
  const follow = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau))
  const contour = p => (2 / Math.PI) * Math.asin(Math.sin(p))
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const phases = ['entering', 'recording', 'processing', 'exiting', 'inserting', 'complete']
  const durations = { entering: .37, recording: 3.15, processing: 1.8, exiting: .40, inserting: 2.25, complete: 2.6, cancelled: .23 }
  const words = Array.from(
    '今天把 Toas 的 Matrix HUD 打磨好了：录音更流畅，Processing 动画也更克制。\n' +
    'Next step: verify GNOME Shell 50 on Wayland, review the ASR output, and ship a lightweight release — 简单、稳定、可维护。'
  )
  const glyphs = {
    C: ['0111', '1000', '1000', '1000', '0111'],
    A: ['0110', '1001', '1111', '1001', '1001'],
    N: ['1001', '1101', '1011', '1001', '1001'],
    E: ['1111', '1000', '1110', '1000', '1111'],
    L: ['1000', '1000', '1000', '1000', '1111']
  }
  const base = [135, 192, 255], core = [229, 242, 255], amber = [216, 154, 121]
  const rates = [.55, .85, 1.25, 1.65]
  const spatial = [1.4, 2.4, 3.8, 5.6]
  const coeff = [.32, .20, .13, .08]

  let mode = 'auto', stage = 'entering', stageTime = 0, time = 0, last = 0
  let width = DESIGN_HEIGHT, voice = 0, goal = 0, processMix = 0
  let hover = 0, hoverAim = 0, pointerStart = null
  let raf = 0, visible = true, audio = null, soundOn = false, typedCount = -1
  let head = 0, sampleTime = 0, signalPhase = [.1, 1.7, 3.3, 4.6]
  const history = new Float32Array(64)
  const cached = new Map()
  let temporary = null
  const tones = new Set()

  function stopCues() {
    for (const oscillator of tones) {
      try { oscillator.stop() } catch { /* Already stopped. */ }
    }
    tones.clear()
  }

  function cue(kind) {
    stopCues()
    if (!soundOn || !audio || audio.state !== 'running') return
    const notes = kind === 'start'
      ? [[740, .20, 0, .07], [1110, .21, .048, .055], [1480, .095, .049, .015]]
      : [[590, .11, 0, .085], [790, .058, 0, .025], [440, .15, .02, .035]]
    for (const [frequency, duration, delay, amplitude] of notes) {
      const oscillator = audio.createOscillator()
      const envelope = audio.createGain()
      const at = audio.currentTime + delay
      oscillator.frequency.value = frequency
      envelope.gain.setValueAtTime(.00001, at)
      envelope.gain.linearRampToValueAtTime(amplitude, at + .008)
      envelope.gain.exponentialRampToValueAtTime(.00001, at + duration)
      oscillator.connect(envelope).connect(audio.destination)
      oscillator.onended = () => {
        tones.delete(oscillator)
        oscillator.disconnect()
        envelope.disconnect()
      }
      tones.add(oscillator)
      oscillator.start(at)
      oscillator.stop(at + duration + .012)
    }
  }

  function clearOutput() {
    typedCount = -1
    output.textContent = ''
    placeholder.hidden = false
  }

  function insert(progress) {
    const count = reduced.matches ? words.length : Math.min(words.length, Math.floor(clamp(progress) * words.length))
    if (count === typedCount) return
    typedCount = count
    output.textContent = words.slice(0, count).join('')
    placeholder.hidden = count > 0
  }

  function setStage(next) {
    stage = next
    stageTime = 0
    root.dataset.phase = next
    phaseLabel.textContent = next.toUpperCase()
    const messages = {
      entering: ['Starting voice input…', 'The compact HUD expands over your desktop.'],
      recording: ['Listening…', 'The mirrored dot matrix responds to simulated speech.'],
      processing: ['Processing…', 'Audio has ended. Toas prepares the transcription.'],
      exiting: ['Finishing…', 'The HUD contracts and fades away.'],
      inserting: ['Inserting into Notes…', 'Watch the result appear in the focused editor.'],
      complete: ['Text inserted.', 'Chinese and English, exactly where you were typing.'],
      cancelled: ['Cancelled.', 'The voice input was discarded without inserting text.']
    }
    status.textContent = messages[next][0]
    detail.textContent = messages[next][1]
    pill.disabled = next !== 'recording' && next !== 'processing'
    if (next === 'entering') {
      stopCues()
      clearOutput()
      width = DESIGN_HEIGHT
      time = 0
      voice = goal = processMix = sampleTime = 0
      hover = hoverAim = 0
      pointerStart = null
      signalPhase = [.1, 1.7, 3.3, 4.6]
      history.fill(0)
      head = 0
      for (const grid of cached.values()) { grid.head.fill(0); grid.tail.fill(0) }
      if (temporary) { temporary.head.fill(0); temporary.tail.fill(0) }
      if (mode === 'auto') cue('start')
    } else if (next === 'processing') {
      if (mode === 'auto') cue('end')
    } else if (next === 'inserting') {
      clearOutput()
      insert(0)
    } else if (next === 'complete') {
      insert(1)
    } else if (next === 'cancelled') {
      stopCues()
      hoverAim = 0
      pointerStart = null
    }
  }

  function setMode(next) {
    mode = next
    modeButtons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.demoMode === next)))
    if (next === 'auto') {
      setStage('entering')
    } else if (next === 'recording') {
      setStage('entering')
      setStage('recording')
      width = RECORD_WIDTH
      cue('start')
    } else if (next === 'processing') {
      setStage('entering')
      setStage('processing')
      width = PROCESS_WIDTH
      processMix = 1
    } else if (next === 'insert') {
      setStage('entering')
      setStage('inserting')
    }
    schedule()
  }

  function cancel() {
    if (stage !== 'recording' && stage !== 'processing') return
    mode = 'paused'
    modeButtons.forEach(button => button.setAttribute('aria-pressed', 'false'))
    setStage('cancelled')
    schedule()
  }

  function geometry(w) {
    const cols = Math.max(2, Math.floor(w / STEP))
    const xy = new Float32Array(cols * ROWS * 2)
    const edge = new Float32Array(cols * ROWS)
    const taper = new Float32Array(cols)
    const glyph = new Uint8Array(cols * ROWS)
    const ox = w / 2 - (cols - 1) * STEP / 2
    const oy = DESIGN_HEIGHT / 2 - (ROWS - 1) * STEP / 2
    for (let x = 0; x < cols; x++) {
      const u = x / (cols - 1)
      taper[x] = Math.min(smooth(u * 7), smooth((1 - u) * 7))
      for (let y = 0; y < ROWS; y++) {
        const i = x * ROWS + y, px = ox + x * STEP, py = oy + y * STEP
        const dx = Math.max(0, Math.abs(px - w / 2) - (w - DESIGN_HEIGHT) / 2)
        xy[i * 2] = px
        xy[i * 2 + 1] = py
        edge[i] = smooth((DESIGN_HEIGHT / 2 - Math.hypot(dx, py - DESIGN_HEIGHT / 2) - 1.1) / 4.8) *
          (1 - .55 * smooth((Math.abs(py - DESIGN_HEIGHT / 2) / (DESIGN_HEIGHT / 2) - .37) / .63))
      }
    }
    if (cols >= 29) {
      const left = Math.floor((cols - 29) / 2), top = Math.floor((ROWS - 5) / 2)
      for (let k = 0; k < 6; k++)
        for (let y = 0; y < 5; y++)
          for (let x = 0; x < 4; x++)
            if (glyphs['CANCEL'[k]][y][x] === '1') glyph[(left + k * 5 + x) * ROWS + top + y] = 1
    }
    return {
      width: w, cols, xy, edge, taper, glyph,
      path: [new Float32Array(cols), new Float32Array(cols)],
      strength: new Float32Array(cols),
      head: new Float32Array(cols * ROWS),
      tail: new Float32Array(cols * ROWS)
    }
  }

  function gridFor(width) {
    if (width === RECORD_WIDTH || width === PROCESS_WIDTH) {
      if (!cached.has(width)) cached.set(width, geometry(width))
      return cached.get(width)
    }
    if (!temporary || temporary.width !== width) temporary = geometry(width)
    return temporary
  }

  function advance(dt) {
    time += dt
    const recording = stage === 'recording' || stage === 'entering'
    const working = stage === 'processing' || stage === 'exiting'
    if (recording) {
      sampleTime += dt
      while (sampleTime >= .1) {
        sampleTime -= .1
        const phrase = (time % 2.35) / 2.35
        const envelope = phrase < .8 ? Math.pow(Math.max(0, Math.sin(Math.PI * phrase / .8)), .55) : .02
        const syllables = .5 * Math.sin(time * 15) ** 2 + .5 * Math.sin(time * 23) ** 2
        goal = .85 * smooth(clamp(.05 + envelope * (.15 + .83 * syllables)))
        history[head] = goal
        head = (head + 1) % history.length
      }
    } else goal = 0
    voice = follow(voice, goal, dt, goal > voice ? .13 : .22)
    processMix = follow(processMix, working ? 1 : 0, dt, .22)
    const rate = recording ? 1 : working ? .15 : 0
    const speed = voice * .35 + .42
    for (let i = 0; i < signalPhase.length; i++) signalPhase[i] += dt * TAU * rates[i] * speed * rate
    hover = reduced.matches ? hoverAim : follow(hover, hoverAim, dt, .105)
  }

  function sample(age) {
    const offset = Math.floor(age), t = age - offset
    const newer = (head - 1 - offset + history.length) % history.length
    const older = (newer - 1 + history.length) % history.length
    return mix(history[newer], history[older], t)
  }

  function draw() {
    const visibleHud = ['entering', 'recording', 'processing', 'exiting', 'cancelled'].includes(stage)
    const target = stage === 'recording' || stage === 'entering' ? RECORD_WIDTH :
      stage === 'exiting' || stage === 'cancelled' ? EXIT_WIDTH : PROCESS_WIDTH
    if (stage === 'entering') {
      const ease = 1 - Math.pow(1 - smooth(stageTime / durations.entering), 3)
      width = reduced.matches ? RECORD_WIDTH : mix(DESIGN_HEIGHT, RECORD_WIDTH, ease)
    } else if (stage === 'exiting' || stage === 'cancelled') {
      const duration = durations[stage]
      width = reduced.matches ? EXIT_WIDTH : mix(PROCESS_WIDTH, EXIT_WIDTH, smooth(stageTime / duration))
    } else {
      width = reduced.matches ? target : follow(width, target, 1 / FPS, .13)
    }
    const nativeWidth = Math.max(18, Math.round(width * SCALE))
    pill.style.width = nativeWidth + 'px'
    pill.style.opacity = !visibleHud ? '0' : String(
      stage === 'entering' ? (reduced.matches ? 1 : smooth(stageTime / .24)) :
      stage === 'exiting' || stage === 'cancelled'
        ? (reduced.matches ? 0 : 1 - smooth(stageTime / durations[stage])) : 1)
    if (!visibleHud || (reduced.matches && (stage === 'exiting' || stage === 'cancelled'))) return

    const dpr = Math.min(devicePixelRatio || 1, 3)
    const pw = Math.round(nativeWidth * dpr), ph = Math.round(HUD_HEIGHT * dpr)
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
    const designWidth = Math.round(nativeWidth / SCALE)
    const offset = (nativeWidth - designWidth * SCALE) * dpr / 2
    ctx.setTransform(SCALE * dpr, 0, 0, SCALE * dpr, offset, 0)
    ctx.clearRect(0, 0, designWidth, DESIGN_HEIGHT)

    const grid = gridFor(designWidth)
    const { xy, edge, taper, glyph, path, strength } = grid
    const rec = 1 - processMix, work = processMix
    const t = reduced.matches ? 1.7 : time
    const amp = .30 + .15 * (.5 + .5 * Math.sin(t * TAU / 5.5)) + 1.95 * Math.pow(voice, .72)
    const carrier = t * TAU * .17, mid = (ROWS - 1) / 2
    for (let col = 0; col < grid.cols; col++) {
      const u = col / (grid.cols - 1), ends = taper[col]
      const past = sample(1 + u * 13)
      strength[col] = rec * (.65 + .45 * Math.sqrt(voice)) * ends
      for (let k = 0; k < 2; k++) {
        const v = k === 0 ? past : past * .86
        let spread = 0
        for (let j = 0; j < 4; j++) spread += coeff[j] * Math.sin(TAU * spatial[j] * u - signalPhase[j]) * v
        path[k][col] = mid + (k === 0 ? -1 : 1) * ends *
          (amp * contour(TAU * 1.55 * u - carrier + (k === 1 ? .12 : 0)) + spread * .68) * rec
      }
    }
    const keepHead = Math.exp(-1 / (FPS * .12))
    const keepTail = Math.exp(-1 / (FPS * .38))
    const beam = (((t * .64) % 1.42) - .19) * grid.width
    const morph = smooth(hover)
    const exit = stage === 'exiting' || stage === 'cancelled' ? smooth(stageTime / durations[stage]) : 0

    for (let i = 0; i < edge.length; i++) {
      const mask = edge[i]
      if (mask <= .015) continue
      const x = xy[2 * i], y = xy[2 * i + 1]
      const col = Math.floor(i / ROWS), row = i % ROWS
      const up = Math.exp(-Math.pow(row - path[0][col], 2) / .63) * strength[col]
      const down = Math.exp(-Math.pow(row - path[1][col], 2) / .63) * strength[col]
      const current = 1 - (1 - clamp(up)) * (1 - clamp(down))
      grid.head[i] = Math.max(grid.head[i] * keepHead, current * .75)
      grid.tail[i] = Math.max(grid.tail[i] * keepTail, current * .84)
      const glow = Math.max(current, grid.head[i], grid.tail[i] * .33)
      const pass = Math.exp(-Math.pow((x - beam) / 10, 2)) * 1.35
      const center = Math.exp(-Math.pow((y - DESIGN_HEIGHT / 2) / 4.7, 2))
      const working = clamp((.18 + .08 * Math.pow(Math.sin(TAU * 1.25 * x / grid.width - carrier), 2) + pass) * center) * taper[col]
      let power = (glow * rec + working * work) * (1 - .58 * smooth(exit))
      power = power * (1 - morph) + (glyph[i] ? .98 : .015) * morph
      const val = clamp(power)
      const fresh = current / (glow + .0001)
      const radius = STEP * (.24 + .20 * Math.pow(val, .62))
      const alpha = (.077 * (1 - .65 * smooth(Math.abs(y - DESIGN_HEIGHT / 2) / (DESIGN_HEIGHT / 2))) +
        .923 * Math.pow(val, .78)) * mask
      if (alpha < .009) continue
      const bright = Math.min(.97, val * val * 1.15) * (.34 + .66 * clamp(fresh))
      const warning = morph * (glyph[i] ? .88 : .10)
      const rgb = base.map((v, n) => Math.round(mix(mix(v, core[n], bright), amber[n], warning)))
      if (val > .08) {
        ctx.fillStyle = `rgba(${rgb.join(',')},${(.12 * val * val * mask).toFixed(3)})`
        ctx.beginPath(); ctx.arc(x, y, radius * 1.7, 0, TAU); ctx.fill()
      }
      ctx.fillStyle = `rgba(${rgb.join(',')},${alpha.toFixed(3)})`
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill()
    }
  }

  function frame(now) {
    raf = 0
    if (!visible || document.hidden) return
    const interval = reduced.matches ? 140 : 1000 / FPS
    if (last && now - last < interval - 2) { raf = requestAnimationFrame(frame); return }
    const dt = last ? Math.min((now - last) / 1000, .24) : .033
    last = now
    stageTime += dt
    advance(dt)

    if (mode === 'auto') {
      if (stageTime >= durations[stage]) {
        const at = phases.indexOf(stage)
        setStage(phases[(at + 1) % phases.length])
      }
    } else if (mode === 'insert' && stage === 'inserting' && stageTime >= durations.inserting) {
      setStage('complete')
    }
    if (stage === 'inserting') insert(stageTime / durations.inserting)
    draw()
    const animating = mode === 'auto' || stage === 'recording' || stage === 'processing' ||
      stage === 'inserting' || (stage === 'cancelled' && stageTime < durations.cancelled)
    if (animating) raf = requestAnimationFrame(frame)
  }

  function schedule() {
    if (!visible || document.hidden) return
    if (!raf) { last = 0; raf = requestAnimationFrame(frame) }
  }

  function onVisibilityChange() {
    if (document.hidden || !visible) { cancelAnimationFrame(raf); raf = 0; last = 0 }
    else schedule()
  }

  for (const button of modeButtons) button.addEventListener('click', () => setMode(button.dataset.demoMode))
  replay.addEventListener('click', () => setMode('auto'))
  soundButton.addEventListener('click', async () => {
    if (soundOn) {
      soundOn = false
      stopCues()
    } else {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (Ctor) {
        try {
          audio ??= new Ctor({ latencyHint: 'interactive' })
          if (audio.state === 'suspended') await audio.resume()
          soundOn = audio.state === 'running'
        } catch { soundOn = false }
      }
    }
    soundButton.setAttribute('aria-pressed', String(soundOn))
    soundButton.textContent = soundOn ? 'Sound on' : 'Sound off'
  })
  pill.addEventListener('pointermove', event => {
    if (pill.disabled) return
    if (!pointerStart) { pointerStart = [event.clientX, event.clientY]; return }
    if (Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) >= 3) {
      hoverAim = 1
      schedule()
    }
  })
  pill.addEventListener('pointerleave', () => { hoverAim = 0; pointerStart = null; schedule() })
  pill.addEventListener('click', cancel)
  document.addEventListener('visibilitychange', onVisibilityChange)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      onVisibilityChange()
    }, { threshold: .05 }).observe(root)
  }
  reduced.addEventListener?.('change', schedule)
  modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demoMode === mode)))
  setStage('entering')
  draw()
  schedule()
})()
