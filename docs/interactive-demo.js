// Browser-only preview of the experimental HUD. No microphone or network access.
(() => {
  const root = document.querySelector('[data-interactive-demo]')
  if (!root) return
  const $ = selector => root.querySelector(selector)
  const canvas = $('[data-demo-canvas]'), pill = $('[data-matrix-pill]')
  const play = $('[data-demo-play]'), hold = $('[data-demo-hold]')
  const sound = $('[data-demo-sound]'), status = $('[data-demo-status]')
  const detail = $('[data-demo-detail]'), phaseLabel = $('[data-demo-phase]')
  const result = $('[data-demo-result]'), ctx = canvas.getContext('2d')
  if (!ctx) return

  const TAU = Math.PI * 2, H = 40, REC = 164, PROC = 136, ROWS = 11, STEP = 3.5
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x) }
  const mix = (a, b, t) => a + (b - a) * t
  const contour = x => (2 / Math.PI) * Math.asin(Math.sin(x))
  const letters = {
    C: ['0111','1000','1000','1000','0111'], A: ['0110','1001','1111','1001','1001'],
    N: ['1001','1101','1011','1001','1001'], E: ['1111','1000','1110','1000','1111'],
    L: ['1000','1000','1000','1000','1111']
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let phase = 'ready', width = REC, voice = 0, hover = 0, hoverAim = 0
  let raf = 0, timer = 0, last = 0, elapsed = 0, visible = true, pressed = false
  let soundOn = false, audio = null, pointerStart = null
  const playing = new Set()
  const stopCues = () => {
    for (const oscillator of playing) {
      try { oscillator.stop() } catch { /* already stopped */ }
    }
    playing.clear()
  }
  const isActive = () => phase === 'recording' || phase === 'processing'

  function show(next, description) {
    phase = next
    root.dataset.phase = next
    phaseLabel.textContent = next.toUpperCase()
    status.textContent = {
      ready: 'Ready when you are', recording: 'Listening…',
      processing: 'Turning speech into text…', complete: 'All done.', cancelled: 'Cancelled.'
    }[next]
    detail.textContent = description
    pill.disabled = !isActive()
    result.hidden = next !== 'complete'
    play.textContent = next === 'ready' ? 'Play walkthrough' : 'Replay walkthrough'
  }

  function cue(kind) {
    stopCues()
    if (!soundOn || !audio || audio.state !== 'running') return
    const notes = kind === 'start'
      ? [[740,.20,0,.07],[1110,.21,.048,.055],[1480,.095,.049,.015]]
      : [[590,.11,0,.085],[790,.058,0,.025],[440,.15,.02,.035]]
    for (const [f,d,delay,amp] of notes) {
      const oscillator = audio.createOscillator(), envelope = audio.createGain()
      const t = audio.currentTime + delay
      oscillator.type = 'sine'
      oscillator.frequency.value = f
      envelope.gain.setValueAtTime(.00001, t)
      envelope.gain.linearRampToValueAtTime(amp, t + .008)
      envelope.gain.exponentialRampToValueAtTime(.00001, t + d)
      oscillator.connect(envelope).connect(audio.destination)
      oscillator.onended = () => { playing.delete(oscillator); oscillator.disconnect(); envelope.disconnect() }
      playing.add(oscillator)
      oscillator.start(t)
      oscillator.stop(t + d + .012)
    }
  }

  function start(auto = false) {
    hold.classList.remove('is-held')
    clearTimeout(timer)
    timer = 0
    pressed = !auto
    elapsed = 0
    voice = 0
    hoverAim = hover = 0
    width = reduced.matches ? REC : H
    show('recording', auto
      ? 'Watch a short recording become a clean result.'
      : 'Release to finish the simulated recording.')
    cue('start')
    if (auto) timer = setTimeout(finish, 2700)
    run()
  }

  function finish() {
    if (phase !== 'recording') return
    clearTimeout(timer)
    pressed = false
    elapsed = 0
    show('processing', 'The voice input is complete. Processing is now underway.')
    cue('end')
    timer = setTimeout(complete, 2050)
    run()
  }

  function complete() {
    if (phase !== 'processing') return
    clearTimeout(timer)
    elapsed = 0
    show('complete', 'Text is ready for the focused application.')
    run()
  }

  function cancel() {
    if (!isActive()) return
    stopCues()
    hold.classList.remove('is-held')
    clearTimeout(timer)
    pressed = false
    show('cancelled', 'The simulated voice input was discarded.')
    run()
  }

  // The canvas uses the original 46x11 lattice, mirrored angular contours,
  // quiet edges, amber CANCEL pixels, and a restrained processing scan.
  function draw(now = performance.now()) {
    const target = phase === 'processing' || phase === 'complete' ? PROC : REC
    width = reduced.matches ? target : mix(width, target, .23)
    const w = Math.round(width), dpr = Math.min(devicePixelRatio || 1, 3)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(H * dpr)
    }
    pill.style.width = w + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, H)
    const cols = Math.round((w - STEP) / STEP)
    const ox = (w - (cols - 1) * STEP) / 2, oy = (H - (ROWS - 1) * STEP) / 2
    const t = reduced.matches ? 1.4 : now / 1000
    const rec = phase === 'recording' ? 1 : 0
    const busy = phase === 'processing' ? 1 : 0
    const rest = phase === 'ready' ? .25 : 0
    const beam = (((t * .64) % 1.42) - .19) * w
    const glyphX = Math.floor((cols - 29) / 2), glyphY = 3
    const morph = smooth(hover)

    for (let x = 0; x < cols; x++) {
      const u = x / (cols - 1), xx = ox + x * STEP
      const fade = Math.min(smooth(u * 7), smooth((1 - u) * 7))
      const wave = contour(TAU * 1.55 * u - t * 1.3) * (.9 + voice * 2.4)
        + Math.sin(TAU * 2.4 * u - t * 2.3) * voice * 1.4
      const hi = (ROWS - 1) / 2 - wave * fade
      const lo = (ROWS - 1) / 2 + wave * fade * .86
      const pass = Math.exp(-(((xx - beam) / 10) ** 2)) * 1.35
      for (let y = 0; y < ROWS; y++) {
        const yy = oy + y * STEP
        const dx = Math.max(0, Math.abs(xx - w / 2) - (w - H) / 2)
        const distance = H / 2 - Math.hypot(dx, yy - H / 2)
        const edge = smooth((distance - 1.1) / 4.8)
        if (edge < .02) continue
        const trace = (1 - (1 - clamp(Math.exp(-(((y - hi) ** 2) / .63)) * fade))
          * (1 - clamp(Math.exp(-(((y - lo) ** 2) / .63)) * fade * .85))) * (.50 + voice * .65) * rec
        const center = Math.exp(-(((yy - H / 2) / 4.7) ** 2))
        const processing = (.18 + .08 * Math.sin(TAU * 1.25 * u - t) ** 2 + pass)
          * center * fade * busy
        const value = clamp(Math.max(trace, processing, rest * center * fade))
        const letter = Math.floor((x - glyphX) / 5), letterX = (x - glyphX) % 5
        const glyphRow = y - glyphY
        const glyph = x >= glyphX && letter >= 0 && letter < 6 && letterX >= 0 && letterX < 4
          && glyphRow >= 0 && glyphRow < 5 && letters['CANCEL'[letter]][glyphRow][letterX] === '1'
        const power = mix(value, glyph ? .99 : .01, morph)
        const alpha = clamp((.077 + .92 * power ** .8) * edge)
        if (alpha < .01) continue
        const cool = [132, 193, 255], hot = [237, 247, 255], amber = [216, 154, 121]
        const rgb = cool.map((channel, n) => Math.round(mix(
          mix(channel, hot[n], clamp(power * power * 1.18)), amber[n], morph * (glyph ? .9 : .1)
        )))
        const radius = STEP * (.24 + .20 * power ** .62)
        if (power > .09) {
          ctx.fillStyle = `rgba(${rgb.join(',')},${(.11 * power * power * edge).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(xx, yy, radius * 1.65, 0, TAU)
          ctx.fill()
        }
        ctx.fillStyle = `rgba(${rgb.join(',')},${alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(xx, yy, radius, 0, TAU)
        ctx.fill()
      }
    }
  }

  function frame(now) {
    raf = 0
    if (!visible || document.hidden) return
    if (last && now - last < 1000 / 30 - 2) {
      raf = requestAnimationFrame(frame)
      return
    }
    const dt = last ? Math.min((now - last) / 1000, .08) : .033
    last = now
    elapsed += dt
    if (phase === 'recording') {
      const phrase = (elapsed % 2.35) / 2.35
      const envelope = phrase < .8 ? Math.pow(Math.max(0, Math.sin(Math.PI * phrase / .8)), .55) : .02
      const syllables = .5 * Math.sin(elapsed * 15) ** 2 + .5 * Math.sin(elapsed * 23) ** 2
      voice = mix(voice, clamp(.03 + envelope * (.15 + .83 * syllables)), .3)
    } else voice *= .87
    hover = mix(hover, hoverAim, .34)
    draw(now)
    if (!reduced.matches && (isActive() || Math.abs(width - (phase === 'processing' || phase === 'complete' ? PROC : REC)) > .5 || Math.abs(hover - hoverAim) > .01))
      raf = requestAnimationFrame(frame)
  }

  function run() {
    if (document.hidden || !visible) return
    if (reduced.matches) { draw(); return }
    if (!raf) { last = 0; raf = requestAnimationFrame(frame) }
  }

  play.addEventListener('click', () => start(true))
  hold.addEventListener('pointerdown', e => {
    if (e.button !== 0 || pressed) return
    e.preventDefault()
    hold.setPointerCapture(e.pointerId)
    start()
    hold.classList.add('is-held')
  })
  hold.addEventListener('pointerup', () => {
    if (!pressed) return
    hold.classList.remove('is-held')
    finish()
  })
  hold.addEventListener('pointercancel', () => { hold.classList.remove('is-held'); cancel() })
  hold.addEventListener('keydown', e => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !pressed) {
      e.preventDefault(); start(); hold.classList.add('is-held')
    }
  })
  hold.addEventListener('keyup', e => {
    if ((e.key === ' ' || e.key === 'Enter') && pressed) {
      e.preventDefault(); hold.classList.remove('is-held'); finish()
    }
  })
  hold.addEventListener('blur', () => {
    if (pressed) { hold.classList.remove('is-held'); finish() }
  })
  sound.addEventListener('click', async () => {
    if (soundOn) {
      stopCues()
      soundOn = false
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
    sound.setAttribute('aria-pressed', String(soundOn))
    sound.textContent = soundOn ? 'Sound on' : 'Sound off'
  })
  pill.addEventListener('pointermove', e => {
    if (!isActive()) return
    if (!pointerStart) { pointerStart = [e.clientX, e.clientY]; return }
    if (Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 3) {
      hoverAim = 1; run()
    }
  })
  pill.addEventListener('pointerleave', () => { pointerStart = null; hoverAim = 0; run() })
  pill.addEventListener('click', cancel)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0 } else run()
  })
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      if (visible) run()
      else { cancelAnimationFrame(raf); raf = 0 }
    }, { threshold: .04 }).observe(root)
  }
  window.addEventListener('resize', run)
  reduced.addEventListener?.('change', run)
  show('ready', 'No microphone needed. Everything runs in your browser.')
  draw()
})()
