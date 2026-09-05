// Minimal cancellation signal for processing attempts.
//
// GJS does not provide AbortController/AbortSignal, so the Host carries its
// own signal with the tiny surface the Kernel and HttpTransport rely on:
// `aborted`, `abort()`, addEventListener/removeEventListener('abort').
// The composition root creates one per attempt; cancelling or destroying the
// orchestrator aborts it.

export class AttemptSignal {
  constructor () {
    this._aborted = false
    this._listeners = []
  }

  get aborted () {
    return this._aborted
  }

  abort () {
    if (this._aborted) { return }
    this._aborted = true
    for (const listener of this._listeners.splice(0)) {
      listener()
    }
  }

  addEventListener (_type, listener) {
    if (this._aborted) {
      listener()
      return
    }
    this._listeners.push(listener)
  }

  removeEventListener (_type, listener) {
    const index = this._listeners.indexOf(listener)
    if (index >= 0) { this._listeners.splice(index, 1) }
  }
}
