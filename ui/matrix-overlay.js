import Cairo from 'cairo'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Pango from 'gi://Pango'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { calculateOverlayPosition, selectMonitor } from './placement.js'
import {
  HUD_EXIT_WIDTH,
  HUD_HEIGHT,
  HUD_PROCESS_WIDTH,
  HUD_RECORD_WIDTH,
  MATRIX_FPS,
  MatrixHoverIntent,
  MatrixRenderer,
  MatrixSignal
} from './matrix-hud.js'

const BOTTOM_MARGIN = 112
const ENTER_MS = 370
const COMPLETE_MS = 400
const CANCEL_MS = 230
const ERROR_EXIT_MS = 180
const GLOW_WIDTH = 480
const GLOW_HEIGHT = 220
const GLOW_OPACITY = 215

// Compact near-field bloom with weaker, offset ambient sources.
// All sources are circular; their overlap creates the irregular light field.
const GLOW_SOURCES = [
  // x, y, radius (logical px), peak alpha.
  [.50, .49, 108, .15],
  [.54, .62, 96, .075],
  [.36, .45, 148, .025],
  [.67, .52, 142, .022],
  [.52, .68, 164, .016]
]

// Cairo paints this once when the drawing area is created or resized.
function paintGlow(cr, width, height) {
  for (const [x, y, radius, alpha] of GLOW_SOURCES) {
    const cx = width * x
    const cy = height * y
    const gradient = new Cairo.RadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStopRGBA(0, .20, .38, .98, alpha)
    gradient.addColorStopRGBA(.36, .23, .35, .95, alpha * .48)
    gradient.addColorStopRGBA(.76, .29, .30, .86, alpha * .10)
    gradient.addColorStopRGBA(1, .29, .30, .86, 0)

    cr.setSource(gradient)
    cr.arc(cx, cy, radius, 0, Math.PI * 2)
    cr.fill()
  }
}

export class MatrixOverlayView {
  constructor() {
    this._signal = new MatrixSignal()
    this._renderer = new MatrixRenderer()
    this._hover = 0
    this._hoverIntent = new MatrixHoverIntent()
    this._timer = 0
    this._cancelRequested = false
    this._exitStarted = 0
    this._exitDuration = COMPLETE_MS
    this._exitProgress = 0
    this._mode = 'hidden'
    this._monitorIndex = null
    this._compositingHeld = false
    this._hiding = false
    this._destroyed = false

    // Independent, non-interactive light field behind the unchanged HUD.
    this._glow = new St.DrawingArea({
      width: GLOW_WIDTH,
      height: GLOW_HEIGHT,
      visible: false,
      reactive: false,
      can_focus: false,
      opacity: 0
    })
    this._glow.connect('repaint', area => this._repaintGlow(area))

    this._matrix = new St.DrawingArea({
      name: 'toas-matrix-canvas',
      width: HUD_RECORD_WIDTH,
      height: HUD_HEIGHT,
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
      name: 'toas-matrix-overlay',
      style_class: 'toas-matrix-overlay',
      height: HUD_HEIGHT,
      child: content,
      visible: false,
      reactive: true,
      track_hover: true,
      can_focus: true,
      accessible_name: 'Cancel voice input'
    })
    this._overlay.connect('clicked', () => {
      if (!this._hiding && (this._mode === 'recording' || this._mode === 'busy')) {
        this._cancelRequested = true
        this._onCancelRequested?.()
      }
    })
    // An existing pointer may already be over the new overlay when it
    // appears. Only an actual motion event in this run enables CANCEL.
    this._overlay.connect('motion-event', (_actor, event) => {
      if (!this._hiding && (this._mode === 'recording' || this._mode === 'busy')) {
        const [x, y] = event.get_coords()
        const wasHovering = this._hoverIntent.active
        this._hoverIntent.move(x, y)
        if (!St.Settings.get().enable_animations &&
            this._hoverIntent.active !== wasHovering) {
          this._hover = this._hoverIntent.active ? 1 : 0
          this._matrix.queue_repaint()
        }
      }
      return Clutter.EVENT_PROPAGATE
    })
    this._overlay.connect('leave-event', () => {
      const wasHovering = this._hoverIntent.active
      this._hoverIntent.reset()
      if (!St.Settings.get().enable_animations && wasHovering) {
        this._hover = 0
        this._matrix.queue_repaint()
      }
      return Clutter.EVENT_PROPAGATE
    })

    Main.layoutManager.addTopChrome(this._glow)
    Main.layoutManager.addTopChrome(this._overlay)
    this._overlay.connect('notify::width', () => this._syncTranslation())
    this._overlay.connect('notify::height', () => this._syncTranslation())
    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
      this._monitorIndex = null
      this._reposition()
    })
    this._reposition()
  }

  render(state, message = '') {
    if (state === 'error') {
      this._error.text = String(message || 'Voice input failed').trim()
    }
  }

  setMode(mode) {
    const previousMode = this._mode
    this._mode = mode
    if (!St.Settings.get().enable_animations) {
      this._signal.processMix = mode === 'busy' ? 1 : 0
    }
    const matrixVisible = mode === 'recording' || mode === 'busy'
    this._matrix.visible = matrixVisible
    this._error.visible = mode === 'error'
    this._overlay.reactive = matrixVisible
    this._overlay.can_focus = matrixVisible
    if (matrixVisible) {
      const targetWidth = mode === 'recording' ? HUD_RECORD_WIDTH : HUD_PROCESS_WIDTH
      this._matrix.remove_all_transitions()
      if (previousMode === 'recording' && mode === 'busy' && St.Settings.get().enable_animations) {
        this._matrix.ease({
          width: targetWidth,
          duration: 260,
          mode: Clutter.AnimationMode.EASE_IN_OUT_SINE
        })
      } else {
        this._matrix.width = targetWidth
      }
    } else {
      this._fadeGlowOut(180)
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

  resetLevels() {
    this._signal.reset()
    this._renderer.reset()
    this._cancelRequested = false
    this._hover = 0
    this._hoverIntent.reset()
    this._matrix.queue_repaint()
  }

  setLevel(rms) {
    if (this._mode !== 'recording') {
      return
    }
    this._signal.pushRms(rms)
    // In GNOME's reduced-motion mode there is no interpolation timer. Levels
    // still update only on the existing 100 ms capture window.
    if (!St.Settings.get().enable_animations) {
      this._signal.voice = this._signal.goal
      this._matrix.queue_repaint()
    }
  }

  show() {
    if (!this._overlay.visible || this._hiding) {
      const [x, y] = global.get_pointer()
      this._hoverIntent.reset(x, y)
      this._hover = 0
    }
    this._hiding = false
    this._exitProgress = 0
    this._overlay.remove_all_transitions()
    this._acquireCompositing()
    this._reposition()
    if (this._mode === 'recording' || this._mode === 'busy') {
      const alreadyVisible = this._glow.visible
      this._glow.remove_all_transitions()
      this._glow.show()
      if (St.Settings.get().enable_animations) {
        if (!alreadyVisible) {
          this._glow.opacity = 0
        }
        this._glow.ease({
          opacity: GLOW_OPACITY,
          duration: 300,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC
        })
      } else {
        this._glow.opacity = GLOW_OPACITY
      }
    }
    this._overlay.reactive = this._mode === 'recording' || this._mode === 'busy'
    if (!this._overlay.visible) {
      const enteringMatrix = this._mode === 'recording' || this._mode === 'busy'
      const finalWidth = this._matrix.width
      if (enteringMatrix && St.Settings.get().enable_animations) {
        this._matrix.width = HUD_HEIGHT
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
        this._overlay.ease({
          opacity: 255,
          duration: 240,
          mode: Clutter.AnimationMode.EASE_OUT_CUBIC
        })
      } else {
        this._overlay.opacity = 255
      }
    } else {
      this._overlay.opacity = 255
    }
    if (this._mode === 'recording' || this._mode === 'busy') {
      this._startAnimation()
    }
  }

  hide() {
    if (this._hiding || !this._overlay?.visible) {
      return
    }
    this._hiding = true
    this._overlay.reactive = false
    this._hoverIntent.reset()
    this._overlay.remove_all_transitions()
    this._matrix.remove_all_transitions()
    if (!St.Settings.get().enable_animations) {
      this._finishHide()
      return
    }

    this._exitDuration = this._cancelRequested ? CANCEL_MS :
      this._mode === 'busy' ? COMPLETE_MS : ERROR_EXIT_MS
    this._exitStarted = GLib.get_monotonic_time()
    this._fadeGlowOut(this._exitDuration)

    if (this._matrix.visible) {
      this._matrix.ease({
        width: HUD_EXIT_WIDTH,
        duration: this._exitDuration,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE
      })
    }
    this._overlay.ease({
      opacity: 0,
      duration: this._exitDuration,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        if (this._hiding && !this._destroyed) {
          this._finishHide()
        }
      }
    })
  }

  _finishHide() {
    this._stopAnimation()
    this._glow.remove_all_transitions()
    this._glow.opacity = 0
    this._glow.hide()
    this._overlay.hide()
    this._mode = 'hidden'
    this._hover = 0
    this._hoverIntent.reset()
    this._cancelRequested = false
    this._exitProgress = 0
    this._hiding = false
    this._releaseCompositing()
  }

  _fadeGlowOut(duration) {
    if (!this._glow.visible) {
      return
    }
    this._glow.remove_all_transitions()
    if (!St.Settings.get().enable_animations) {
      this._glow.opacity = 0
      this._glow.hide()
      return
    }
    this._glow.ease({
      opacity: 0,
      duration,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onStopped: () => {
        if (!this._destroyed && this._glow?.opacity === 0) {
          this._glow.hide()
        }
      }
    })
  }

  _startAnimation() {
    if (this._timer || !St.Settings.get().enable_animations) {
      return
    }
    let previous = GLib.get_monotonic_time()
    this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, Math.round(1000 / MATRIX_FPS), () => {
      if (this._destroyed || !this._overlay.visible ||
          (this._mode !== 'recording' && this._mode !== 'busy')) {
        this._timer = 0
        return GLib.SOURCE_REMOVE
      }
      const now = GLib.get_monotonic_time()
      const dt = Math.min(0.1, (now - previous) / 1000000)
      previous = now
      this._signal.advance(dt, this._mode)
      if (this._hiding) {
        this._exitProgress = Math.min(1, (now - this._exitStarted) /
          (this._exitDuration * 1000))
      }
      const targetHover = !this._hiding && this._hoverIntent.active ? 1 : 0
      this._hover += (targetHover - this._hover) * (1 - Math.exp(-dt / .105))
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

  _repaintGlow(area) {
    const cr = area.get_context()
    try {
      const [width, height] = area.get_surface_size()
      paintGlow(cr, width, height)
    } finally {
      cr.$dispose()
    }
  }

  _repaint(area) {
    if (this._mode !== 'recording' && this._mode !== 'busy') {
      return
    }
    const cr = area.get_context()
    try {
      const [w, h] = area.get_surface_size()
      this._renderer.paintSurface(
        cr, w, h, this._signal, this._hover, this._exitProgress
      )
    } finally {
      // St.DrawingArea's Cairo context must be explicitly disposed in GJS.
      cr.$dispose()
    }
  }

  _reposition() {
    if (!this._overlay) {
      return
    }
    const monitor = selectMonitor(
      Main.layoutManager.monitors, Main.layoutManager.primaryMonitor, this._monitorIndex
    )
    if (!monitor) {
      return
    }

    const [, w] = this._overlay.get_preferred_width(-1)
    const [, h] = this._overlay.get_preferred_height(w)
    const { x, y } = calculateOverlayPosition(monitor, w, h, BOTTOM_MARGIN)
    this._overlay.set_position(x, y)
    // Keep the light centered on the monitor while the HUD morphs its width.
    const glowMargin = BOTTOM_MARGIN + (HUD_HEIGHT - GLOW_HEIGHT) / 2 - 6
    const glow = calculateOverlayPosition(monitor, GLOW_WIDTH, GLOW_HEIGHT, glowMargin)
    this._glow.set_position(glow.x, glow.y)
    this._overlay.translation_x = 0
    this._overlay.translation_y = 0
  }

  _syncTranslation() {
    const monitor = selectMonitor(
      Main.layoutManager.monitors, Main.layoutManager.primaryMonitor, this._monitorIndex
    )
    if (!monitor || !this._overlay || this._overlay.width <= 0 || this._overlay.height <= 0) {
      return
    }

    const { x, y } = calculateOverlayPosition(
      monitor, this._overlay.width, this._overlay.height, BOTTOM_MARGIN
    )
    // Size transitions need visual centering, not another allocation.
    this._overlay.translation_x = x - this._overlay.x
    this._overlay.translation_y = y - this._overlay.y
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
    this._destroyed = true
    this._stopAnimation()
    this._renderer?.clear()
    this._matrix?.remove_all_transitions()
    this._glow?.remove_all_transitions()
    this._overlay?.remove_all_transitions()
    this._releaseCompositing()
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId)
    }
    if (this._glow) {
      Main.layoutManager.removeChrome(this._glow)
      this._glow.destroy()
    }
    if (this._overlay) {
      Main.layoutManager.removeChrome(this._overlay)
      this._overlay.destroy()
    }
    this._overlay = null
    this._glow = null
    this._matrix = null
    this._error = null
    this._signal = null
    this._renderer = null
    this._onCancelRequested = null
    this._hoverIntent.reset()
    this._hoverIntent = null
  }
}
