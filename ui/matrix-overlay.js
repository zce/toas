import Cairo from 'cairo'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { AudioLevelMeter } from './level-meter.js'
import { calculateOverlayPosition, selectMonitor } from './placement.js'
import { MATRIX_FPS, MATRIX_HEIGHT, PROCESS_WIDTH, RECORD_WIDTH, paintMatrix } from './matrix-hud.js'

const BOTTOM_MARGIN = 112
const ENTER_MS = 200
const EXIT_MS = 180

// Opt-in alternate *view* for the existing ToasOverlayPresenter. No change to
// capture, refinement, notifications or output state. No permanent work.
export class MatrixOverlayView {
  constructor() {
    this._levelMeter = new AudioLevelMeter()
    this._level = 0
    this._targetLevel = 0
    this._hover = 0
    this._clock = 0
    this._timer = 0
    this._mode = 'hidden'
    this._monitorIndex = null
    this._compositingHeld = false
    this._hiding = false
    this._destroyed = false

    this._matrix = new St.DrawingArea({
      width: RECORD_WIDTH,
      height: MATRIX_HEIGHT,
      y_align: Clutter.ActorAlign.CENTER
    })
    this._matrix.connect('repaint', area => this._repaint(area))

    this._error = new St.Label({
      style_class: 'toas-matrix-error-label',
      visible: false,
      y_align: Clutter.ActorAlign.CENTER
    })
    this._error.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END)
    this._error.get_clutter_text().set_single_line_mode(true)

    const content = new St.BoxLayout()
    content.add_child(this._matrix)
    content.add_child(this._error)
    this._overlay = new St.Button({
      style_class: 'toas-matrix-overlay',
      child: content,
      visible: false,
      reactive: true,
      track_hover: true,
      can_focus: true,
      accessible_name: 'Cancel voice input'
    })
    this._overlay.connect('clicked', () => {
      if (!this._hiding && (this._mode === 'recording' || this._mode === 'busy')) {
        this._onCancelRequested?.()
      }
    })
    this._overlay.connect('notify::hover', () => {
      if (!St.Settings.get().enable_animations) {
        this._hover = this._overlay.hover ? 1 : 0
        this._matrix.queue_repaint()
      }
    })

    Main.layoutManager.addTopChrome(this._overlay)
    this._overlay.connect('notify::width', () => this._reposition())
    this._overlay.connect('notify::height', () => this._reposition())
    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this._monitorIndex = null
      this._reposition()
    })
    this._reposition()
  }

  render(state, message = '') {
    if (state === 'error') {
      const label = String(message || 'Voice input failed').trim()
      this._error.text = label.length > 52 ? label.slice(0, 51) + '…' : label
    }
  }

  setMode(mode) {
    const was = this._mode
    this._mode = mode
    const matrixVisible = mode === 'recording' || mode === 'busy'
    this._matrix.visible = matrixVisible
    this._error.visible = mode === 'error'
    this._overlay.reactive = matrixVisible
    this._overlay.can_focus = matrixVisible
    if (matrixVisible) {
      const target = mode === 'recording' ? RECORD_WIDTH : PROCESS_WIDTH
      this._matrix.remove_all_transitions()
      if (was === 'recording' && mode === 'busy' && St.Settings.get().enable_animations) {
        this._matrix.ease({
          width: target,
          duration: 260,
          mode: Clutter.AnimationMode.EASE_IN_OUT_SINE
        })
      } else {
        this._matrix.width = target
      }
    } else {
      this._stopAnimation()
    }
    this._matrix.queue_repaint()
    this._reposition()
  }

  setOnCancelRequested(handler) {
    this._onCancelRequested = handler
  }

  setMonitor(index) {
    this._monitorIndex = Number.isInteger(index) && index >= 0 ? index : null
    this._reposition()
  }

  setPrivate(enabled) {
    // Privacy status is still shown by the native top-bar indicator. The
    // experimental HUD has no icon slots, by design.
    this._private = Boolean(enabled)
  }

  resetLevels() {
    this._levelMeter.reset()
    this._targetLevel = 0
    this._level = 0
    this._clock = 0
    this._matrix.queue_repaint()
  }

  setLevel(rms) {
    if (this._mode !== 'recording') return
    this._targetLevel = this._levelMeter.push(rms)
    // In GNOME's reduced-motion mode there is no interpolation timer. Levels
    // still update only on the existing 100 ms capture window.
    if (!St.Settings.get().enable_animations) {
      this._level = this._targetLevel
      this._matrix.queue_repaint()
    }
  }

  show() {
    this._hiding = false
    this._overlay.remove_all_transitions()
    this._acquireCompositing()
    this._reposition()
    this._overlay.reactive = this._mode === 'recording' || this._mode === 'busy'
    if (!this._overlay.visible) {
      const enteringMatrix = this._mode === 'recording' || this._mode === 'busy'
      const finalWidth = this._matrix.width
      if (enteringMatrix && St.Settings.get().enable_animations) {
        // The dots expand with the capsule, rather than appearing in an
        // already-full-width box. Only the normal compositor is animated.
        this._matrix.width = 90
      }
      this._overlay.show()
      if (St.Settings.get().enable_animations) {
        if (enteringMatrix) {
          this._matrix.ease({
            width: finalWidth,
            duration: ENTER_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC
          })
        }
        this._overlay.opacity = 0
        this._overlay.translation_y = 8
        this._overlay.ease({
          opacity: 255,
          translation_y: 0,
          duration: ENTER_MS,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC
        })
      } else {
        this._overlay.opacity = 255
        this._overlay.translation_y = 0
      }
    } else {
      this._overlay.opacity = 255
      this._overlay.translation_y = 0
    }
    if (this._mode === 'recording' || this._mode === 'busy') this._startAnimation()
  }

  hide() {
    if (this._hiding || !this._overlay?.visible) return
    this._hiding = true
    this._overlay.reactive = false
    this._stopAnimation()
    this._overlay.remove_all_transitions()
    this._matrix.remove_all_transitions()
    if (!St.Settings.get().enable_animations) {
      this._finishHide()
      return
    }
    if (this._matrix.visible) {
      this._matrix.ease({
        width: 90,
        duration: EXIT_MS,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE
      })
    }
    this._overlay.ease({
      opacity: 0,
      duration: EXIT_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        if (this._hiding && !this._destroyed) this._finishHide()
      }
    })
  }

  _finishHide() {
    this._overlay.hide()
    this._mode = 'hidden'
    this._hover = 0
    this._hiding = false
    this._releaseCompositing()
  }

  _startAnimation() {
    if (this._timer || !St.Settings.get().enable_animations) return
    let previous = GLib.get_monotonic_time()
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, Math.round(1000/MATRIX_FPS), () => {
      if (this._destroyed || this._hiding || !this._overlay.visible ||
          (this._mode !== 'recording' && this._mode !== 'busy')) {
        this._timer = 0
        return GLib.SOURCE_REMOVE
      }
      const now = GLib.get_monotonic_time()
      const dt = Math.min(0.1, (now - previous)/1000000)
      previous = now
      this._clock += dt
      // Small per-frame target interpolation for smooth RMS response.
      this._level += (this._targetLevel - this._level) * Math.min(1, dt*9)
      const targetHover = this._overlay.hover ? 1 : 0
      this._hover += (targetHover - this._hover) * Math.min(1, dt*13)
      this._matrix.queue_repaint()
      return GLib.SOURCE_CONTINUE
    })
  }

  _stopAnimation() {
    if (this._timer) {
      GLib.source_remove(this._timer)
      this._timer = 0
    }
  }

  _repaint(area) {
    if (this._mode !== 'recording' && this._mode !== 'busy') return
    const cr = area.get_context()
    try {
      const [w,h] = area.get_surface_size()
      paintMatrix(cr,w,h,this._mode,this._clock,this._level,this._hover)
    } finally {
      // St.DrawingArea's Cairo context must be explicitly disposed in GJS.
      cr.$dispose()
    }
  }

  _reposition() {
    if (!this._overlay) return
    const monitor = selectMonitor(Main.layoutManager.monitors,
      Main.layoutManager.primaryMonitor, this._monitorIndex)
    if (!monitor) return
    const [,w] = this._overlay.get_preferred_width(-1)
    const [,h] = this._overlay.get_preferred_height(w)
    const {x,y} = calculateOverlayPosition(monitor,w,h,BOTTOM_MARGIN)
    this._overlay.set_position(x,y)
  }

  _acquireCompositing() {
    if (this._compositingHeld) return
    global.compositor.disable_unredirect()
    this._compositingHeld = true
  }

  _releaseCompositing() {
    if (!this._compositingHeld) return
    global.compositor.enable_unredirect()
    this._compositingHeld = false
  }

  destroy() {
    this._destroyed = true
    this._stopAnimation()
    this._matrix?.remove_all_transitions()
    this._overlay?.remove_all_transitions()
    this._releaseCompositing()
    if (this._monitorsChangedId) Main.layoutManager.disconnect(this._monitorsChangedId)
    if (this._overlay) {
      Main.layoutManager.removeChrome(this._overlay)
      this._overlay.destroy()
    }
    this._overlay = null
    this._matrix = null
    this._error = null
    this._onCancelRequested = null
  }
}
