import Pango from 'gi://Pango'
import Clutter from 'gi://Clutter'
import St from 'gi://St'

import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

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
  }

  // Wire-through so the composition root does not need the raw view.
  setOnCancelRequested (handler) {
    this._view.setOnCancelRequested?.(handler)
  }

  get view () {
    return this._view
  }

  setPrivate (enabled) {
    const next = Boolean(enabled)
    if (this._private === next) { return }

    this._private = next
    // The view decorates the overlay through its own style class and shield
    // icon. The flag rides the run snapshot, not the live switch: the
    // orchestrator sets it per run so a mid-run switch never decorates a
    // non-private run.
    this._view.setPrivate?.(next)
  }

  render (state, message = '') {
    this._generation++
    this._clearTimer()

    if (state === 'idle') {
      // Keep whatever is on screen so the fade-out stays continuous: tearing
      // children down first would flash an empty pill or a lone spinner.
      // hideOnStop removes the spinner as part of the same transition.
      this._view.stopSpinner()
      this._view.hide()
      return
    }

    const recording = state === 'recording'
    const error = state === 'error'
    const label = STATE_LABELS[state] ?? ''

    this._view.render(state, error ? (message || 'Voice input failed') : label)
    // Errors carry their message in the label slot even though they have no
    // STATE_LABELS entry; without the error check the pill would show empty.
    this._view.setVisible(recording, error, error || label !== '')

    if (!recording && !error) { this._view.startSpinner() } else { this._view.stopSpinner() }

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
  processing: 'Processing…',
  outputting: 'Inserting…'
}

// Shell side of the overlay: owns St/Clutter actors and GNOME Shell imports.
// The presenter drives it through the view interface.

const BAR_COUNT = 9
const BAR_MIN_HEIGHT = 2
// Keep the .toas-bars height in stylesheet.css in sync with this value.
const BAR_MAX_HEIGHT = 20
const OVERLAY_BOTTOM_MARGIN = 112

export class ShellOverlayView {
  constructor () {
    this._levels = Array(BAR_COUNT).fill(0)
    this._compositingHeld = false

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

    // Same shield icon language as the top-bar menu switch; shown while a
    // private recording runs.
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

    // This is transient system feedback, so keep it above application windows.
    // Do not use trackFullscreen: tracked actors are hidden in fullscreen.
    Main.layoutManager.addTopChrome(this._actor)

    this._monitorsChangedId = Main.layoutManager.connect(
      'monitors-changed',
      () => this._reposition()
    )

    this._reposition()
  }

  render (state, message = '') {
    // Copy only; visibility and spinner are owned by the presenter via
    // setVisible/startSpinner so the two layers cannot drift.
    const error = state === 'error'
    this._status.text = error ? truncate(message || 'Voice input failed') : message
  }

  setVisible (recording, error, statusVisible) {
    this._icon.visible = recording
    this._bars.visible = recording
    this._status.visible = statusVisible
    // The private shield rides along with the microphone; it exists only
    // while private mode is on, so visibility alone can never leak the hint.
    this._privateIcon.visible = recording && this._private
    // The close action is available during recording and processing, but not
    // for a terminal error state (it self-dismisses).
    this._closeButton.visible = !error
  }

  setOnCancelRequested (handler) {
    this._onCancelRequested = handler
  }

  setPrivate (enabled) {
    this._private = Boolean(enabled)
    if (this._private) {
      this._actor.add_style_class_name('toas-private')
    } else {
      this._actor.remove_style_class_name('toas-private')
    }
    // Re-evaluate the shield visibility for a live recording.
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
    this._renderLevels()
  }

  show () {
    this._reposition()
    // A new recording can start while the previous hide animation is still
    // running. Stop it so the stale onStopped callback cannot hide this run.
    this._actor.remove_all_transitions()
    this._acquireCompositing()

    if (this._actor.visible) {
      this._actor.opacity = 255
      return
    }

    this._actor.show()
    // Keep stage changes steady; only the first appearance fades in.
    this._actor.opacity = 0
    this._actor.ease({
      opacity: 255,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    })
  }

  hide () {
    this._closeButton.visible = false
    if (!this._actor.visible) {
      this._releaseCompositing()
      return
    }

    this._actor.ease({
      opacity: 0,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        // Only hide if nothing re-showed during the transition.
        if (this._actor && this._actor.opacity === 0) {
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

    this._renderLevels()
  }

  _renderLevels () {
    this._barActors.forEach((bar, index) => {
      const shaped = Math.pow(this._levels[index] ?? 0, 0.45)
      const height = Math.round(
        BAR_MIN_HEIGHT + shaped * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT)
      )
      // Height is per-frame audio data; it is layout state, not styling.
      // Setting it directly avoids a CSS parse per bar on every frame.
      bar.height = height
    })
  }

  _reposition () {
    const monitor = Main.layoutManager.primaryMonitor
    if (!monitor || !this._actor) { return }

    const [, width] = this._actor.get_preferred_width(-1)
    const [, height] = this._actor.get_preferred_height(width)
    const x = Math.round(monitor.x + (monitor.width - width) / 2)
    const y = Math.round(
      monitor.y + monitor.height - OVERLAY_BOTTOM_MARGIN - height
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

    // Kill any in-flight ease before tearing down the chrome actor.
    this._actor?.remove_all_transitions()
    this._releaseCompositing()

    if (this._monitorsChangedId) { Main.layoutManager.disconnect(this._monitorsChangedId) }

    if (this._actor) {
      Main.layoutManager.removeChrome(this._actor)
      this._actor.destroy()
    }

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
