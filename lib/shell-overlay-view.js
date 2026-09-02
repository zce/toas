// Shell side of the overlay: owns St/Clutter actors and GNOME Shell imports.
// The presenter (overlay-presenter.js) drives it through the view interface.

import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import Clutter from 'gi://Clutter'
import St from 'gi://St'

import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

const BAR_COUNT = 9
const BAR_MIN_HEIGHT = 2
// Keep the .toas-bars height in stylesheet.css in sync with this value.
const BAR_MAX_HEIGHT = 20
const OVERLAY_BOTTOM_MARGIN = 112

export class ShellOverlayView {
  constructor () {
    this._levels = Array(BAR_COUNT).fill(0)

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
    this._spinner.style_class = 'toas-spinner'

    this._closeButton = new St.Button({
      style_class: 'toas-close-button icon-button',
      child: new St.Icon({
        icon_name: 'window-close-symbolic',
        icon_size: 10
      }),
      visible: false,
      y_align: Clutter.ActorAlign.CENTER
    })
    this._closeButton.connect('clicked', () => {
      this._closeButton.visible = false
      this._onCancelRequested?.()
    })

    this._actor.add_child(this._icon)
    this._actor.add_child(this._bars)
    this._actor.add_child(this._spinner)
    this._actor.add_child(this._status)
    this._actor.add_child(this._closeButton)

    // Do not use trackFullscreen: LayoutManager owns and rewrites the
    // visibility of tracked actors whenever overview visibility changes.
    Main.layoutManager.addChrome(this._actor)

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
    // The close action is available during recording and processing, but not
    // for a terminal error state (it self-dismisses).
    this._closeButton.visible = !error
  }

  setOnCancelRequested (handler) {
    this._onCancelRequested = handler
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
    if (!this._actor.visible) { return }

    this._actor.ease({
      opacity: 0,
      duration: 150,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        // Only hide if nothing re-showed during the transition.
        if (this._actor && this._actor.opacity === 0) {
          this._actor.hide()
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
      bar.set_style(`height: ${height}px;`)
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

  destroy () {
    this._spinner?.stop()
    this._onCancelRequested = null

    // Kill any in-flight ease before tearing down the chrome actor.
    this._actor?.remove_all_transitions()

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
    this._barActors = []
  }
}

function truncate (text) {
  const value = (text ?? '').trim()
  if (value.length <= 42) { return value }

  return `${value.slice(0, 41)}…`
}
