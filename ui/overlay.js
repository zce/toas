import Pango from 'gi://Pango'
import Clutter from 'gi://Clutter'
import St from 'gi://St'

import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { calculateOverlayPosition, selectMonitor } from './placement.js'

// The overlay presenter owns the state machine and delegates all St/Clutter
// work to an injected view. ShellOverlayView below owns the Shell wiring.

const ERROR_HIDE_MS = 2400

export class ToasOverlayPresenter {
  constructor ({ view, hideDelay = ERROR_HIDE_MS } = {}) {
    this._view = view
    this._hideDelay = hideDelay
    this._timer = null
    this._generation = 0
    this._private = false
    this._mode = 'hidden'
  }

  setOnCancelRequested (handler) {
    this._view.setOnCancelRequested?.(handler)
  }

  setMonitor (monitorIndex) {
    this._view.setMonitor?.(monitorIndex)
  }

  setPrivate (enabled) {
    const next = Boolean(enabled)
    if (this._private === next) { return }

    this._private = next
    // The flag is the run snapshot, not the live switch, so changing Private
    // mode mid-run cannot decorate a non-private run.
    this._view.setPrivate?.(next)
  }

  render (state, message = '') {
    this._generation++
    this._clearTimer()

    if (state === 'idle') {
      if (this._mode === 'busy') { this._view.stopSpinner() }
      this._mode = 'hidden'
      // Keep whatever is on screen so the fade-out stays continuous: tearing
      // children down first would flash an empty pill or a lone spinner.
      this._view.hide()
      return
    }

    const mode = visualModeFor(state)
    const error = mode === 'error'
    const label = STATE_LABELS[state] ?? ''

    if (mode !== this._mode) {
      if (this._mode === 'busy') { this._view.stopSpinner() }
      if (mode === 'busy') { this._view.startSpinner() }
    }
    this._mode = mode

    this._view.render(state, error ? (message || 'Voice input failed') : label)
    this._view.setMode(mode)
    this._view.show()

    if (error) {
      const generation = this._generation
      this._timer = setTimeout(() => {
        this._timer = null
        if (generation === this._generation) {
          this._view.hide()
        }
      }, this._hideDelay)
    }
  }

  setLevel (level) {
    this._view.setLevel(level)
  }

  resetLevels () {
    this._view.resetLevels?.()
  }

  destroy () {
    this._clearTimer()
    if (this._mode === 'busy') { this._view.stopSpinner() }
    this._mode = 'hidden'
    this._view.destroy?.()
  }

  _clearTimer () {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }
}

const STATE_LABELS = {
  transcribing: 'Transcribing…',
  refining: 'Refining…',
  outputting: 'Inserting…',
  copying: 'Copying…'
}

function visualModeFor (state) {
  if (state === 'recording') { return 'recording' }
  if (state === 'error') { return 'error' }
  if (Object.hasOwn(STATE_LABELS, state)) { return 'busy' }
  return 'hidden'
}

const BAR_COUNT = 9
const BAR_MIN_HEIGHT = 2
// Keep the .toas-bars height in stylesheet.css in sync with this value.
const BAR_MAX_HEIGHT = 20
const OVERLAY_BOTTOM_MARGIN = 112

export class ShellOverlayView {
  constructor () {
    this._levels = Array(BAR_COUNT).fill(0)
    this._compositingHeld = false
    this._monitorIndex = null

    this._glow = new St.Widget({
      style_class: 'toas-overlay-glow',
      reactive: false,
      visible: false
    })

    this._actor = new St.BoxLayout({
      style_class: 'toas-overlay',
      reactive: false,
      visible: false
    })
    this._actor.connect('notify::width', () => this._reposition())

    this._icon = new St.Icon({
      style_class: 'toas-icon',
      icon_name: 'audio-input-microphone-symbolic',
      y_align: Clutter.ActorAlign.CENTER
    })

    this._bars = new St.BoxLayout({
      style_class: 'toas-bars',
      y_align: Clutter.ActorAlign.CENTER
    })

    this._barActors = []
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = new St.Widget({
        style_class: 'toas-bar',
        y_align: Clutter.ActorAlign.CENTER
      })
      this._barActors.push(bar)
      this._bars.add_child(bar)
    }

    this._status = new St.Label({
      style_class: 'toas-status',
      text: '',
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER
    })
    this._status.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END)
    this._status.get_clutter_text().set_single_line_mode(true)

    this._spinner = new Spinner(16, { hideOnStop: true })
    this._spinner.add_style_class_name('toas-spinner')

    this._closeButton = new St.Button({
      style_class: 'toas-close-button icon-button',
      child: new St.Icon({
        icon_name: 'window-close-symbolic',
        style_class: 'toas-close-icon'
      }),
      visible: false,
      y_align: Clutter.ActorAlign.CENTER
    })
    this._closeButton.connect('clicked', () => {
      this._closeButton.visible = false
      this._onCancelRequested?.()
    })

    this._privateIcon = new St.Icon({
      style_class: 'toas-private-icon',
      icon_name: 'security-medium-symbolic',
      y_align: Clutter.ActorAlign.CENTER
    })

    this._actor.add_child(this._icon)
    this._actor.add_child(this._bars)
    this._actor.add_child(this._privateIcon)
    this._actor.add_child(this._spinner)
    this._actor.add_child(this._status)
    this._actor.add_child(this._closeButton)

    // The glow is decorative only, so keep it outside chrome tracking.
    // Add it first so the interactive capsule is always painted above it.
    Main.layoutManager.uiGroup.add_child(this._glow)
    Main.layoutManager.addTopChrome(this._actor)

    this._monitorsChangedId = Main.layoutManager.connect(
      'monitors-changed',
      () => {
        // Monitor indices may be reassigned after a topology change. Do not
        // risk moving a live run to a different display: safe fallback is the
        // primary monitor, with no attempt to build a hotplug tracker.
        this._monitorIndex = null
        this._reposition()
      }
    )

    this._reposition()
  }

  render (state, message = '') {
    const error = state === 'error'
    this._status.text = error ? truncate(message || 'Voice input failed') : message
  }

  setMode (mode) {
    const recording = mode === 'recording'
    const busy = mode === 'busy'
    const error = mode === 'error'

    this._icon.visible = recording
    this._bars.visible = recording
    this._status.visible = busy || error
    this._privateIcon.visible = recording && this._private
    this._closeButton.visible = recording || busy

    if (error) {
      this._actor.add_style_class_name('toas-error')
      this._glow.add_style_class_name('toas-error')
    } else {
      this._actor.remove_style_class_name('toas-error')
      this._glow.remove_style_class_name('toas-error')
    }
  }

  setOnCancelRequested (handler) {
    this._onCancelRequested = handler
  }

  setMonitor (monitorIndex) {
    this._monitorIndex = Number.isInteger(monitorIndex) && monitorIndex >= 0
      ? monitorIndex
      : null
    this._reposition()
  }

  setPrivate (enabled) {
    this._private = Boolean(enabled)
    if (this._private) {
      this._glow.add_style_class_name('toas-private')
    } else {
      this._glow.remove_style_class_name('toas-private')
    }
    this._privateIcon.visible = this._privateIcon.visible && this._private
  }

  startSpinner () {
    this._spinner.play()
  }

  stopSpinner () {
    this._spinner.stop()
  }

  resetLevels () {
    this._levels.fill(0)
    this._barActors.forEach(bar => {
      bar.remove_all_transitions()
      bar.height = BAR_MIN_HEIGHT
    })
  }

  show () {
    this._reposition()
    // A new recording can start while the previous hide animation is still
    // running. Stop it so the stale onStopped callback cannot hide this run.
    this._glow.remove_all_transitions()
    this._actor.remove_all_transitions()
    this._acquireCompositing()

    if (this._actor.visible) {
      this._glow.show()
      this._glow.opacity = 255
      this._actor.opacity = 255
      return
    }

    for (const actor of [this._glow, this._actor]) {
      actor.show()
      actor.opacity = 0
      actor.ease({
        opacity: 255,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD
      })
    }
  }

  hide () {
    this._closeButton.visible = false
    if (!this._actor.visible) {
      this._glow.hide()
      this._releaseCompositing()
      return
    }

    this._glow.ease({
      opacity: 0,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    })
    this._actor.ease({
      opacity: 0,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        // Only hide if nothing re-showed during the transition.
        if (this._actor && this._actor.opacity === 0) {
          this._glow?.hide()
          this._actor.hide()
          this._releaseCompositing()
        }
      }
    })
  }

  setLevel (level) {
    const safeLevel = Math.max(0, Math.min(1, level || 0))
    this._levels.unshift(safeLevel)
    this._levels.length = BAR_COUNT

    this._barActors.forEach((bar, index) => {
      const shaped = Math.pow(this._levels[index] ?? 0, 0.45)
      const height = Math.round(
        BAR_MIN_HEIGHT + shaped * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT)
      )
      bar.ease({
        height,
        duration: 100,
        mode: Clutter.AnimationMode.LINEAR
      })
    })
  }

  _reposition () {
    const monitor = selectMonitor(
      Main.layoutManager.monitors,
      Main.layoutManager.primaryMonitor,
      this._monitorIndex
    )
    if (!monitor || !this._actor || !this._glow) { return }

    const [, glowWidth] = this._glow.get_preferred_width(-1)
    const [, glowHeight] = this._glow.get_preferred_height(glowWidth)
    const glowPosition = calculateOverlayPosition(
      monitor,
      glowWidth,
      glowHeight,
      0
    )
    this._glow.set_position(glowPosition.x, glowPosition.y)

    const [, width] = this._actor.get_preferred_width(-1)
    const [, height] = this._actor.get_preferred_height(width)
    const { x, y } = calculateOverlayPosition(
      monitor,
      width,
      height,
      OVERLAY_BOTTOM_MARGIN
    )
    this._actor.set_position(x, y)
  }

  _acquireCompositing () {
    if (this._compositingHeld) { return }

    global.compositor.disable_unredirect()
    this._compositingHeld = true
  }

  _releaseCompositing () {
    if (!this._compositingHeld) { return }

    global.compositor.enable_unredirect()
    this._compositingHeld = false
  }

  destroy () {
    this._spinner?.stop()
    this._onCancelRequested = null

    // Kill any in-flight ease before tearing down the overlay actors.
    this._glow?.remove_all_transitions()
    this._actor?.remove_all_transitions()
    this._releaseCompositing()

    if (this._monitorsChangedId) { Main.layoutManager.disconnect(this._monitorsChangedId) }

    if (this._actor) {
      Main.layoutManager.removeChrome(this._actor)
      this._actor.destroy()
    }
    this._glow?.destroy()

    this._glow = null
    this._actor = null
    this._icon = null
    this._spinner = null
    this._status = null
    this._closeButton = null
    this._privateIcon = null
    this._barActors = []
  }
}

function truncate (text) {
  const value = (text ?? '').trim()
  if (value.length <= 42) { return value }

  return `${value.slice(0, 41)}…`
}