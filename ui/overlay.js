import Pango from 'gi://Pango'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
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
      this._mode = 'hidden'
      // Keep the final frame intact until the fade finishes. ShellOverlayView
      // performs visual cleanup only after the overlay is fully hidden.
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
const OVERLAY_FADE_MS = 180
const GLOW_RISE_MS = 220
const GLOW_RISE_PX = 18
const WAVEFORM_TIMELINE_MS = 60 * 60 * 1000
const WAVEFORM_ATTACK_MS = 45
const WAVEFORM_RELEASE_MS = 90

export class ShellOverlayView {
  constructor () {
    this._levels = Array(BAR_COUNT).fill(0)
    this._targetHeights = Array(BAR_COUNT).fill(BAR_MIN_HEIGHT)
    this._displayHeights = Array(BAR_COUNT).fill(BAR_MIN_HEIGHT)
    this._waveformRunning = false
    this._waveformFrameUs = 0
    this._compositingHeld = false
    this._monitorIndex = null
    this._mode = 'hidden'

    this._overlay = new St.Widget({
      style_class: 'toas-overlay',
      layout_manager: new Clutter.BinLayout(),
      reactive: false,
      visible: false
    })

    this._glow = new St.Widget({
      style_class: 'toas-glow',
      reactive: false,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER
    })

    this._capsule = new St.BoxLayout({
      style_class: 'toas-capsule',
      reactive: false,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER
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
      bar.height = BAR_MIN_HEIGHT
      this._barActors.push(bar)
      this._bars.add_child(bar)
    }

    // Tie the visual timeline to the bars actor so Clutter can drive it from
    // the Shell frame clock rather than leaving it as an unattached timeline.
    this._waveformTimeline = new Clutter.Timeline({
      actor: this._bars,
      duration: WAVEFORM_TIMELINE_MS
    })
    this._waveformTimeline.connect(
      'new-frame',
      () => this._renderWaveformFrame()
    )

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
      // Preserve the final visual frame while cancellation begins; cleanup is
      // deferred until the overlay has actually faded away.
      this._onCancelRequested?.()
    })

    this._privateIcon = new St.Icon({
      style_class: 'toas-private-icon',
      icon_name: 'security-medium-symbolic',
      y_align: Clutter.ActorAlign.CENTER
    })

    this._capsule.add_child(this._icon)
    this._capsule.add_child(this._bars)
    this._capsule.add_child(this._privateIcon)
    this._capsule.add_child(this._spinner)
    this._capsule.add_child(this._status)
    this._capsule.add_child(this._closeButton)

    // Glow and capsule are two visual layers of one overlay. The glow uses a
    // fixed source, so capsule content changes cannot reshape the atmosphere.
    this._overlay.add_child(this._glow)
    this._overlay.add_child(this._capsule)

    // This is transient system feedback, so keep it above application windows.
    // Do not use trackFullscreen: tracked actors are hidden in fullscreen.
    Main.layoutManager.addTopChrome(this._overlay)

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

    this._mode = mode
    this._icon.visible = recording
    this._bars.visible = recording
    this._status.visible = busy || error
    this._privateIcon.visible = recording && this._private
    this._closeButton.visible = recording || busy

    if (!recording) { this._stopWaveform() }

    if (error) {
      this._overlay.add_style_class_name('toas-error')
    } else {
      this._overlay.remove_style_class_name('toas-error')
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
      this._overlay.add_style_class_name('toas-private')
    } else {
      this._overlay.remove_style_class_name('toas-private')
    }
    this._privateIcon.visible = this._privateIcon.visible && this._private
    this._reposition()
  }

  startSpinner () {
    this._spinner.play()
  }

  stopSpinner () {
    this._spinner.stop()
  }

  resetLevels () {
    this._levels.fill(0)
    this._targetHeights.fill(BAR_MIN_HEIGHT)
    this._displayHeights.fill(BAR_MIN_HEIGHT)
    this._barActors.forEach(bar => {
      bar.height = BAR_MIN_HEIGHT
    })
  }

  show () {
    this._reposition()
    this._overlay.remove_all_transitions()
    this._glow.remove_all_transitions()
    this._acquireCompositing()

    if (this._overlay.visible) {
      // A new non-busy state may have interrupted a busy fade-out before the
      // deferred spinner cleanup ran.
      if (this._mode !== 'busy') { this._spinner.stop() }
      this._overlay.opacity = 255
      this._glow.translation_y = 0
      if (this._mode === 'recording') { this._startWaveform() }
      return
    }

    // Set the initial visual state before mapping the actor so the first frame
    // participates in the fade instead of briefly painting fully opaque.
    this._overlay.opacity = 0
    this._glow.translation_y = GLOW_RISE_PX
    this._overlay.show()
    if (this._mode === 'recording') { this._startWaveform() }

    // Opacity belongs to the whole overlay; the glow gets only the directional
    // motion that makes it feel like light rising from below.
    this._overlay.ease({
      opacity: 255,
      duration: OVERLAY_FADE_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    })
    this._glow.ease({
      translation_y: 0,
      duration: GLOW_RISE_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    })
  }

  hide () {
    if (!this._overlay.visible) {
      this._stopWaveform()
      this._spinner.stop()
      this._closeButton.visible = false
      this._releaseCompositing()
      return
    }

    this._stopWaveform()
    this._overlay.remove_all_transitions()
    this._glow.remove_all_transitions()

    this._overlay.ease({
      opacity: 0,
      duration: OVERLAY_FADE_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD
    })
    this._glow.ease({
      translation_y: GLOW_RISE_PX,
      duration: GLOW_RISE_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        // Only clean up the final frame if nothing re-showed during the fade.
        if (this._overlay && this._overlay.opacity === 0) {
          this._overlay.hide()
          this._spinner.stop()
          this._closeButton.visible = false
          this._releaseCompositing()
        }
      }
    })
  }

  setLevel (level) {
    const safeLevel = Math.max(0, Math.min(1, level || 0))
    this._levels.unshift(safeLevel)
    this._levels.length = BAR_COUNT

    this._levels.forEach((sample, index) => {
      const shaped = Math.pow(sample ?? 0, 0.45)
      this._targetHeights[index] =
        BAR_MIN_HEIGHT + shaped * (BAR_MAX_HEIGHT - BAR_MIN_HEIGHT)
    })
  }

  _startWaveform () {
    if (this._waveformRunning) { return }

    this._waveformRunning = true
    this._waveformFrameUs = GLib.get_monotonic_time()
    this._waveformTimeline.start()
  }

  _stopWaveform () {
    if (!this._waveformRunning) { return }

    this._waveformRunning = false
    this._waveformFrameUs = 0
    this._waveformTimeline.stop()
  }

  _renderWaveformFrame () {
    if (!this._waveformRunning) { return }

    const nowUs = GLib.get_monotonic_time()
    const elapsedMs = this._waveformFrameUs
      ? Math.min(50, Math.max(1, (nowUs - this._waveformFrameUs) / 1000))
      : 16
    this._waveformFrameUs = nowUs

    this._barActors.forEach((bar, index) => {
      const current = this._displayHeights[index]
      const target = this._targetHeights[index]
      const responseMs = target > current
        ? WAVEFORM_ATTACK_MS
        : WAVEFORM_RELEASE_MS
      const alpha = 1 - Math.exp(-elapsedMs / responseMs)
      const next = current + (target - current) * alpha
      const settled = Math.abs(target - next) < 0.05 ? target : next

      this._displayHeights[index] = settled
      if (Math.abs(bar.height - settled) > 0.05) {
        bar.height = settled
      }
    })
  }

  _reposition () {
    const monitor = selectMonitor(
      Main.layoutManager.monitors,
      Main.layoutManager.primaryMonitor,
      this._monitorIndex
    )
    if (!monitor || !this._overlay) { return }

    const [, width] = this._overlay.get_preferred_width(-1)
    const [, height] = this._overlay.get_preferred_height(width)
    const { x, y } = calculateOverlayPosition(
      monitor,
      width,
      height,
      OVERLAY_BOTTOM_MARGIN
    )
    this._overlay.set_position(x, y)
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
    this._stopWaveform()
    this._onCancelRequested = null

    this._overlay?.remove_all_transitions()
    this._glow?.remove_all_transitions()
    this._releaseCompositing()

    if (this._monitorsChangedId) { Main.layoutManager.disconnect(this._monitorsChangedId) }

    if (this._overlay) {
      Main.layoutManager.removeChrome(this._overlay)
      this._overlay.destroy()
    }

    this._overlay = null
    this._glow = null
    this._capsule = null
    this._waveformTimeline = null
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
