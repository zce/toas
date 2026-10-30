import Clutter from 'gi://Clutter'
import Pango from 'gi://Pango'
import St from 'gi://St'
import { Spinner } from 'resource:///org/gnome/shell/ui/animation.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { calculateOverlayPosition, selectMonitor } from './placement.js'
import { AudioLevelMeter } from './level-meter.js'

const BAR_COUNT = 8
const WAVEFORM_EASE_MS = 120
const OVERLAY_BOTTOM_MARGIN = 112
const OVERLAY_ENTER_MS = 220
const OVERLAY_EXIT_MS = 160

// The Shell half of the overlay: builds the actors, animates show/hide, and
// holds compositor unredirect while visible so the waveform stays smooth.
export class ShellOverlayView {
  constructor() {
    this._levels = Array(BAR_COUNT).fill(0)
    this._levelMeter = new AudioLevelMeter()
    this._barTargets = Array(BAR_COUNT).fill(null)
    this._compositingHeld = false
    this._monitorIndex = null
    this._mode = 'hidden'

    this._overlay = new St.BoxLayout({
      style_class: 'toas-overlay',
      reactive: false,
      visible: false
    })

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
      this._onCancelRequested?.()
    })

    this._privateIcon = new St.Icon({
      style_class: 'toas-private-icon',
      icon_name: 'security-medium-symbolic',
      y_align: Clutter.ActorAlign.CENTER
    })

    this._overlay.add_child(this._icon)
    this._overlay.add_child(this._bars)
    this._overlay.add_child(this._privateIcon)
    this._overlay.add_child(this._spinner)
    this._overlay.add_child(this._status)
    this._overlay.add_child(this._closeButton)

    // This is transient system feedback, so keep it above application windows.
    // Do not use trackFullscreen: tracked actors are hidden in fullscreen.
    Main.layoutManager.addTopChrome(this._overlay)

    // Content swaps can change the allocated capsule size after the immediate
    // reposition call. Recenter again when layout settles so the visual center
    // stays pinned to the monitor center, including on first activation.
    this._overlay.connect('notify::width', () => this._reposition())
    this._overlay.connect('notify::height', () => this._reposition())

    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      // Monitor indices may be reassigned after a topology change. Do not
      // risk moving a live run to a different display: safe fallback is the
      // primary monitor, with no attempt to build a hotplug tracker.
      this._monitorIndex = null
      this._reposition()
    })

    this._reposition()
  }

  render(state, message = '') {
    const error = state === 'error'
    this._status.text = error ? truncate(message || 'Voice input failed') : message
  }

  setMode(mode) {
    const recording = mode === 'recording'
    const busy = mode === 'busy'
    const error = mode === 'error'

    if (mode !== this._mode) {
      if (this._mode === 'busy') this._spinner.stop()
      if (busy) this._spinner.play()
      this._mode = mode
    }

    this._icon.visible = recording
    this._bars.visible = recording
    this._status.visible = busy || error
    this._privateIcon.visible = recording && this._private
    this._closeButton.visible = recording || busy

    if (error) {
      this._overlay.add_style_class_name('toas-error')
    } else {
      this._overlay.remove_style_class_name('toas-error')
    }
  }

  setOnCancelRequested(handler) {
    this._onCancelRequested = handler
  }

  setMonitor(monitorIndex) {
    this._monitorIndex = Number.isInteger(monitorIndex) && monitorIndex >= 0 ? monitorIndex : null
    this._reposition()
  }

  setPrivate(enabled) {
    this._private = Boolean(enabled)
    if (this._private) {
      this._overlay.add_style_class_name('toas-private')
    } else {
      this._overlay.remove_style_class_name('toas-private')
    }
    this._privateIcon.visible = this._mode === 'recording' && this._private
    this._reposition()
  }

  resetLevels() {
    this._levelMeter.reset()
    this._levels.fill(0)
    this._barTargets.fill(null)
    this._barActors.forEach(bar => {
      bar.remove_all_transitions()
      // Drop the explicit animated size and return to the CSS resting height.
      bar.height = -1
    })
  }

  show() {
    this._reposition()
    this._overlay.remove_all_transitions()
    this._acquireCompositing()

    if (this._overlay.visible) {
      this._overlay.opacity = 255
      this._overlay.translation_y = 0
      return
    }

    if (!St.Settings.get().enable_animations) {
      this._overlay.opacity = 255
      this._overlay.translation_y = 0
      this._overlay.show()
      return
    }

    const [, width] = this._overlay.get_preferred_width(-1)
    const [, height] = this._overlay.get_preferred_height(width)

    this._overlay.opacity = 0
    this._overlay.translation_y = height
    this._overlay.show()
    this._overlay.ease({
      opacity: 255,
      translation_y: 0,
      duration: OVERLAY_ENTER_MS,
      mode: Clutter.AnimationMode.EASE_OUT_CUBIC
    })
  }

  hide() {
    this._overlay.remove_all_transitions()

    if (!this._overlay.visible || !St.Settings.get().enable_animations) {
      this._finishHide()
      return
    }

    this._overlay.ease({
      opacity: 0,
      duration: OVERLAY_EXIT_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        if (this._overlay?.opacity === 0) {
          this._finishHide()
        }
      }
    })
  }

  setLevel(level) {
    const displayLevel = this._levelMeter.push(level)

    if (this._levelMeter.active) {
      this._levels.unshift(displayLevel)
      this._levels.length = BAR_COUNT
    } else {
      this._levels.fill(0)
    }

    const range = this._waveformRange()
    if (!range) {
      return
    }

    this._barActors.forEach((bar, index) => {
      const shaped = this._levels[index] ?? 0
      const height = Math.round(range.restingHeight + shaped * (range.maxHeight - range.restingHeight))

      if (this._barTargets[index] === null) {
        this._barTargets[index] = range.restingHeight
      }
      if (height === this._barTargets[index]) {
        return
      }
      this._barTargets[index] = height

      bar.ease({
        height,
        duration: WAVEFORM_EASE_MS,
        mode: Clutter.AnimationMode.LINEAR
      })
    })
  }

  _waveformRange() {
    // CSS owns the visual geometry. ThemeNode resolves those lengths with the
    // active Shell scale factor, so JS animates in the same coordinate space.
    const restingHeight = this._barActors[0]?.get_theme_node().get_height() ?? 0
    const maxHeight = this._bars?.get_theme_node().get_height() ?? 0

    if (restingHeight <= 0 || maxHeight < restingHeight) {
      return null
    }
    return { restingHeight, maxHeight }
  }

  _finishHide() {
    this._overlay.hide()
    this._mode = 'hidden'
    this._spinner.stop()
    this._closeButton.visible = false
    this._releaseCompositing()
  }

  _reposition() {
    const monitor = selectMonitor(Main.layoutManager.monitors, Main.layoutManager.primaryMonitor, this._monitorIndex)
    if (!monitor || !this._overlay) {
      return
    }

    const [, width] = this._overlay.get_preferred_width(-1)
    const [, height] = this._overlay.get_preferred_height(width)
    const { x, y } = calculateOverlayPosition(monitor, width, height, OVERLAY_BOTTOM_MARGIN)
    this._overlay.set_position(x, y)
  }

  _acquireCompositing() {
    if (this._compositingHeld) {
      return
    }

    global.compositor.disable_unredirect()
    this._compositingHeld = true
  }

  _releaseCompositing() {
    if (!this._compositingHeld) {
      return
    }

    global.compositor.enable_unredirect()
    this._compositingHeld = false
  }

  destroy() {
    this._spinner?.stop()
    this._onCancelRequested = null

    this._overlay?.remove_all_transitions()
    this._releaseCompositing()

    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId)
    }

    if (this._overlay) {
      Main.layoutManager.removeChrome(this._overlay)
      this._overlay.destroy()
    }

    this._overlay = null
    this._icon = null
    this._spinner = null
    this._status = null
    this._closeButton = null
    this._privateIcon = null
    this._barActors = []
    this._barTargets = []
  }
}

function truncate(text) {
  const value = (text ?? '').trim()
  if (value.length <= 42) return value
  return `${value.slice(0, 41)}…`
}
