const ERROR_HIDE_MS = 2400

// Drives the injected view from voice-input states. A generation counter
// invalidates stale error-hide timers when states change quickly.
export class ToasOverlayPresenter {
  constructor({ view, hideDelay = ERROR_HIDE_MS } = {}) {
    this._view = view
    this._hideDelay = hideDelay
    this._timer = null
    this._generation = 0
    this._onCancelRequested = null
  }

  setOnCancelRequested(handler) {
    this._onCancelRequested = handler
    this._view.setOnCancelRequested?.(handler)
  }

  replaceView(createView) {
    const next = createView()
    this._generation++
    this._clearTimer()
    this._view.destroy?.()
    this._view = next
    next.setOnCancelRequested?.(this._onCancelRequested)
  }

  setMonitor(monitorIndex) {
    this._view.setMonitor?.(monitorIndex)
  }

  setPrivate(enabled) {
    this._view.setPrivate?.(Boolean(enabled))
  }

  render(state, message = '') {
    this._generation++
    this._clearTimer()

    if (state === 'idle') {
      // Keep the current visual mode intact until the fade finishes so the
      // final frame cannot collapse before it disappears.
      this._view.hide()
      return
    }

    const mode = visualModeFor(state)
    const error = mode === 'error'
    const label = STATE_LABELS[state] ?? ''

    this._view.render(state, error ? message || 'Voice input failed' : label)
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

  setLevel(level) {
    this._view.setLevel(level)
  }

  resetLevels() {
    this._view.resetLevels?.()
  }

  destroy() {
    this._clearTimer()
    this._view.destroy?.()
  }

  _clearTimer() {
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

function visualModeFor(state) {
  if (state === 'recording') return 'recording'
  if (state === 'error') return 'error'
  if (Object.hasOwn(STATE_LABELS, state)) return 'busy'
  return 'hidden'
}
