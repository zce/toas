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

export class FakeTranscriber {
  constructor ({ text = 'hello', error = null, delayMs = 0 } = {}) {
    this.text = text
    this.error = error
    this.delayMs = delayMs
    this.calls = []
    this.cancels = 0
  }

  get model () { return 'fake-asr-model' }
  get endpoint () { return 'https://fake.example/endpoint' }
  get language () { return 'auto' }

  async transcribe (recording, model) {
    this.calls.push({ recording, model })
    if (this.delayMs) { await new Promise(resolve => setTimeout(resolve, this.delayMs)) }
    if (this.error) { throw this.error }
    return {
      text: this.text,
      model,
      endpoint: this.endpoint,
      language: this.language,
      finishReason: 'stop',
      usage: null,
      responseModel: 'fake-asr-model',
      responseId: 'fake-id'
    }
  }

  cancel () { this.cancels++ }
  destroy () {}
}

export class FakeRefiner {
  constructor ({ error = null, text = null } = {}) {
    this.error = error
    this.refinedText = text
    this.calls = []
    this.cancels = 0
  }

  get enabled () { return true }
  get model () { return 'fake-refine-model' }
  get endpoint () { return 'https://fake.example/refine' }

  async refine (transcript, model) {
    this.calls.push({ transcript, model })
    if (this.error) { throw this.error }
    return {
      text: this.refinedText ?? transcript.toUpperCase(),
      ran: true,
      reason: null,
      model,
      endpoint: this.endpoint,
      finishReason: 'stop',
      usage: null,
      responseModel: 'fake-refine-model',
      responseId: 'fake-id'
    }
  }

  cancel () { this.cancels++ }
  destroy () {}
}

export class FakePaster {
  constructor ({ delayMs = 0 } = {}) {
    this.delayMs = delayMs
    this.writes = []
    this.cancels = 0
    this.destroys = 0
    this.resolveWrite = null
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
    this.destroys = 0
  }

  render (state, message = '') {
    this.states.push({ state, message })
  }

  setLevel (level) { this.levels.push(level) }
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
