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

    this._actor.add_child(this._icon)
    this._actor.add_child(this._bars)
    this._actor.add_child(this._spinner)
    this._actor.add_child(this._status)

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
  }

  startSpinner () {
    this._spinner.play()
  }

  stopSpinner () {
    this._spinner.stop()
  }

  show () {
    this._reposition()
    this._actor.show()
  }

  hide () {
    this._actor.hide()
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

    if (this._monitorsChangedId) { Main.layoutManager.disconnect(this._monitorsChangedId) }

    if (this._actor) {
      Main.layoutManager.removeChrome(this._actor)
      this._actor.destroy()
    }

    this._actor = null
    this._icon = null
    this._spinner = null
    this._status = null
    this._barActors = []
  }
}

function truncate (text) {
  const value = (text ?? '').trim()
  if (value.length <= 42) { return value }

  return `${value.slice(0, 41)}…`
}