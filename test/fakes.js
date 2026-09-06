// Fake implementations for orchestrator collaborators. Fakes implement the
// same required contracts as production instead of making production code
// optional-chain around incomplete test doubles.

export class FakeRecorder {
  constructor ({ recording = null, stopError = null } = {}) {
    this.recording = recording
    this.stopError = stopError
    this.starts = 0
    this.stops = 0
    this.cancels = 0
    this.destroys = 0
  }

  async start () { this.starts++ }

  async stop () {
    this.stops++
    if (this.stopError) { throw this.stopError }
    return this.recording
  }

  cancel () { this.cancels++ }
  destroy () { this.destroys++ }
}

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
        role: 'primary',
        provider: 'fake',
        model: 'fake-model',
        input: 'audio',
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
  constructor ({ delayMs = 0, deliveryMode = 'insert', focusMismatch = false, error = null } = {}) {
    this.delayMs = delayMs
    this.mode = deliveryMode
    this.focusMismatch = focusMismatch
    this.error = error
    this.writes = []
    this.capturedWindows = []
    this.cancels = 0
    this.destroys = 0
    this.resolveWrite = null
    this.monitorIndex = null
  }

  getFocusedMonitorIndex () { return this.monitorIndex }

  captureFocusedWindow () {
    this.capturedWindows.push(`capture-${this.capturedWindows.length}`)
  }

  async write (text) {
    this.writes.push(text)
    if (this.delayMs) {
      await new Promise(resolve => { this.resolveWrite = resolve })
    }
    if (this.error) { throw this.error }
    if (this.focusMismatch) { return { mode: 'copied', reason: 'focus-mismatch' } }
    return { mode: this.mode === 'clipboard' ? 'copied' : 'inserted' }
  }

  cancel () { this.cancels++ }
  destroy () { this.destroys++ }
}

export class FakeHistory {
  constructor () {
    this.appends = []
    this.discarded = []
    this.attempts = []
    this.entries = []
    this.clears = 0
  }

  get recordingsDirectory () { return '/tmp/fake-recordings' }

  append (entry) {
    this.appends.push(entry)
    this.entries.push(entry)
    return entry
  }

  appendAttempt (original, entry) {
    const attempt = {
      ...entry,
      id: entry.id ?? `attempt-${this.attempts.length + 1}`,
      attemptOf: original.id,
      attemptNumber: this.attempts.filter(candidate => candidate.attemptOf === original.id).length + 1,
      audio: null
    }
    this.attempts.push(attempt)
    this.entries.push(attempt)
    return attempt
  }

  resolveAudio (entry) {
    return {
      available: Boolean(entry?.audio),
      path: entry?.audio ? `/tmp/state/${entry.audio}` : null
    }
  }

  get (id) { return this.entries.find(entry => entry.id === id) ?? null }
  discardRecording (recording) { this.discarded.push(recording) }

  clear () {
    this.clears++
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
    this.monitors = []
  }

  render (state, message = '') { this.states.push({ state, message }) }
  setLevel (level) { this.levels.push(level) }
  resetLevels () { this.resets++ }
  setPrivate (enabled) { this.privateFlags.push(enabled) }
  setMonitor (index) { this.monitors.push(index) }
  destroy () { this.destroys++ }
}

export class FakeNotifier {
  constructor () { this.notifications = [] }

  notify (title, body) {
    this.notifications.push({ title, body })
  }
}
