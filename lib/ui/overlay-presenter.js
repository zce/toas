// The overlay presenter is shell-free: it owns the state machine and delegates
// all St/Clutter work to an injected view. The Shell wiring lives in
// shell-overlay-view.js so the presenter can be unit-tested headless.

const ERROR_HIDE_MS = 2400

export class ToasOverlayPresenter {
  constructor ({ view, hideDelay = ERROR_HIDE_MS } = {}) {
    this._view = view
    this._hideDelay = hideDelay
    this._timer = null
    this._generation = 0
    this._visible = false
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
      this._visible = false
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
    this._visible = true

    if (error) {
      const generation = this._generation
      this._timer = setTimeout(() => {
        this._timer = null
        if (generation === this._generation) {
          this._view.hide()
          this._visible = false
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
