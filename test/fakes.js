// Fake implementations for orchestrator collaborators. Fakes record the calls
// they receive so tests assert on behavior through the same public interfaces
// production code uses. Pure GJS + GLib only: no St/Clutter, no Shell
// resources, so the suite runs with `gjs -m`.

export class FakeRecorder {
  constructor ({ recording = null, stopError = null } = {}) {
    this.recording = recording
    this.stopError = stopError
    this.starts = 0
    this.stops = 0
    this.cancels = 0
    this.destroys = 0
    this.onLevel = null
  }

  async start () {
    this.starts++
  }

  async stop () {
    this.stops++
    if (this.stopError) { throw this.stopError }
    return this.recording
  }

  cancel () {
    this.cancels++
  }

  destroy () {
    this.destroys++
  }
}

// Stand-in for the Host-side Kernel collaborator: same process(recording,
// signal) seam the orchestrator calls in production. delayMs simulates
// in-flight network work so cancellation tests can interrupt mid-attempt.
export class FakeKernel {
  constructor ({ text = 'hello', error = null, warning = null, trace = null, delayMs = 0 } = {}) {
    this.text = text
    this.error = error
    this.warning = warning
    this.trace = trace
    this.delayMs = delayMs
    this.calls = []
    this.receivedSignals = []
  }

  async run (recording, signal) {
    this.calls.push({ recording, signal })
    this.receivedSignals.push(signal)
    if (this.delayMs) { await new Promise(resolve => setTimeout(resolve, this.delayMs)) }
    if (this.error) { throw this.error }

    return {
      text: this.text,
      trace: this.trace ?? [{
        role: 'processing',
        provider: 'fake',
        model: 'fake-model',
        input: 'audio',
        text: this.text,
        status: 'ok',
        elapsedMs: 100,
        context: [],
        usage: null,
        requestId: null,
        responseId: 'fake-id'
      }],
      warning: this.warning
    }
  }
}

export class FakePaster {
  constructor ({ delayMs = 0 } = {}) {
    this.delayMs = delayMs
    this.writes = []
    this.capturedWindows = []
    this.cancels = 0
    this.destroys = 0
    this.resolveWrite = null
  }

  captureFocusedWindow () {
    this.capturedWindows.push(`capture-${this.capturedWindows.length}`)
  }

  async write (text) {
    this.writes.push(text)
    if (this.delayMs) {
      await new Promise(resolve => {
        this.resolveWrite = resolve
      })
    }
  }

  cancel () { this.cancels++ }
  destroy () { this.destroys++ }
}

export class FakeHistory {
  constructor () {
    this.appends = []
    this.discarded = []
    this.clears = 0
  }

  get recordingsDirectory () { return '/tmp/fake-recordings' }

  append (entry) { this.appends.push(entry) }

  discardRecording (recording) { this.discarded.push(recording) }

  clear () {
    this.clears = (this.clears ?? 0) + 1
    return this.appends.length
  }
}

export class FakeOverlay {
  constructor () {
    this.states = []
    this.levels = []
    this.resets = 0
    this.destroys = 0
    this.privateFlags = []
  }

  render (state, message = '') {
    this.states.push({ state, message })
  }

  setLevel (level) { this.levels.push(level) }
  resetLevels () { this.resets++ }
  setPrivate (enabled) { this.privateFlags.push(enabled) }
  destroy () { this.destroys++ }
}

export class FakeNotifier {
  constructor () {
    this.notifications = []
    this.cancels = 0
  }

  notify (title, body) {
    this.notifications.push({ title, body })
  }

  cancel () { this.cancels++ }
}
