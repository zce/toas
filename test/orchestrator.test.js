import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeRecorder, FakeKernel, FakePaster, FakeHistory, FakeOverlay, FakeNotifier } from './fakes.js'
import {
  recordingOutcomeOk,
  recordingOutcomeShortTap,
  recordingOutcomeCaptureFailure,
  recordingOutcomeCancelled
} from '../host/audio.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

class FakeSettings {
  constructor (values = {}) {
    this.values = {
      'private-mode': false,
      'auto-paste': true,
      'audio-quality': 'standard',
      'minimum-recording-duration': 600,
      ...values
    }
  }

  get_boolean (key) { return Boolean(this.values[key]) }
  get_string (key) { return String(this.values[key] ?? '') }
  get_uint (key) { return Number(this.values[key] ?? 0) }
  set_boolean (key, value) { this.values[key] = Boolean(value) }
}

function makeOrchestrator ({
  recorder = new FakeRecorder(),
  kernel = new FakeKernel(),
  output = new FakePaster(),
  history = new FakeHistory(),
  overlay = new FakeOverlay(),
  notifier = new FakeNotifier(),
  settings = new FakeSettings(),
  recorderFactory = null
} = {}) {
  const state = { events: [] }
  const orchestrator = new ToasOrchestrator({
    settings,
    history,
    kernel,
    output,
    overlay,
    notifier,
    recorderFactory: recorderFactory ?? (() => recorder),
    onStateChanged: (name, message) => state.events.push({ state: name, message: message ?? '' })
  })

  return { orchestrator, recorder, kernel, output, history, overlay, notifier, settings, state }
}

function waitFor (predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) { return resolve() }
      if (Date.now() - startedAt > timeoutMs) { return reject(new Error('waitFor timed out')) }
      setTimeout(check, 5)
    }
    check()
  })
}

test('orchestrator requires its runtime collaborators', () => {
  let threw = null
  try {
    new ToasOrchestrator({
      settings: new FakeSettings(),
      history: new FakeHistory(),
      output: new FakePaster(),
      overlay: new FakeOverlay(),
      notifier: new FakeNotifier()
    })
  } catch (error) { threw = error }

  expectTruthy(threw)
  expectEqual(threw.message.includes('kernel'), true)
})

test('recording settings reach the recorder factory as named options', () => {
  let received = null
  const recorder = new FakeRecorder()
  const { orchestrator } = makeOrchestrator({
    recorder,
    settings: new FakeSettings({ 'audio-quality': 'maximum' }),
    recorderFactory: options => {
      received = options
      return recorder
    }
  })

  orchestrator.begin()
  expectEqual(received.sampleRate, 48000)
  expectEqual(received.minimumDurationMs, 600)
  expectEqual(received.recordingsDirectory, '/tmp/fake-recordings')
  orchestrator.cancel()
  orchestrator.destroy()
})

test('normal live voice input records, processes, persists, and delivers once', async () => {
  const recording = { id: 'rec-1', path: '/tmp/rec-1.wav', durationMs: 4200, mimeType: 'audio/wav' }
  const { orchestrator, recorder, kernel, output, history, overlay, state } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(recorder.starts, 1)
  expectEqual(recorder.stops, 1)
  expectEqual(kernel.calls.length, 1)
  expectEqual(output.writes, ['hello'])
  expectEqual(history.appends.length, 1)
  expectEqual(history.appends[0].status, 'ok')
  expectEqual(history.appends[0].text, 'hello')
  expectEqual(history.appends[0].audio.file, 'rec-1.wav')
  expectEqual(history.appends[0].transcribe.text, 'hello')
  expectEqual(history.discarded, [])
  expectEqual(overlay.resets, 1)
  expectEqual(state.events.filter(event => event.state === 'idle').length, 1)
  orchestrator.destroy()
})

test('history separates audio, transcription, refine, usage, and tracing fields', async () => {
  const recording = {
    id: 'rec-structure',
    path: '/tmp/rec-structure.wav',
    durationMs: 4050,
    mimeType: 'audio/wav',
    sampleRate: 8000
  }
  const trace = [
    {
      role: 'primary',
      provider: 'doubao',
      model: 'volc.bigasr.auc_turbo',
      status: 'ok',
      elapsedMs: 509.4,
      usage: null,
      requestId: 'doubao-request',
      responseId: null,
      text: 'raw transcript'
    },
    {
      role: 'refine',
      provider: 'openai-compatible',
      model: 'nvidia/Gemma-4-31B-IT-NVFP4',
      status: 'ok',
      elapsedMs: 606.4,
      usage: { inputTokens: 473, outputTokens: 4, totalTokens: 477 },
      requestId: null,
      responseId: 'refine-response',
      text: 'refined text'
    }
  ]
  const { orchestrator, history } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ text: 'refined text', trace })
  })

  orchestrator.begin()
  await orchestrator.end()

  const entry = history.appends[0]
  expectTruthy(entry.time)
  expectEqual(entry.audio, {
    file: 'rec-structure.wav',
    durationMs: 4050,
    sampleRate: 8000
  })
  expectEqual(entry.transcribe, {
    provider: 'doubao',
    model: 'volc.bigasr.auc_turbo',
    text: 'raw transcript',
    latencyMs: 509,
    requestId: 'doubao-request'
  })
  expectEqual(entry.refine, {
    provider: 'openai-compatible',
    model: 'nvidia/Gemma-4-31B-IT-NVFP4',
    text: 'refined text',
    latencyMs: 606,
    usage: { inputTokens: 473, outputTokens: 4, totalTokens: 477 },
    responseId: 'refine-response'
  })
  expectEqual(Object.hasOwn(entry, 'trace'), false)
  expectEqual(Object.hasOwn(entry, 'warning'), false)
  expectEqual(Object.hasOwn(entry, 'createdAt'), false)
  orchestrator.destroy()
})

test('clipboard-only delivery uses copying state without fallback notification', async () => {
  const recording = { id: 'rec-copy', path: '/tmp/rec-copy.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, state, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    settings: new FakeSettings({ 'auto-paste': false }),
    output: new FakePaster({ deliveryMode: 'clipboard' })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(state.events.some(event => event.state === 'copying'), true)
  expectEqual(state.events.some(event => event.state === 'outputting'), false)
  expectEqual(notifier.notifications, [])
  orchestrator.destroy()
})

test('target-window mismatch reports the actual clipboard fallback', async () => {
  const recording = { id: 'rec-focus', path: '/tmp/rec-focus.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    output: new FakePaster({ focusMismatch: true })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(notifier.notifications, [{
    title: 'Copied to clipboard',
    body: 'The target window changed, so your text was copied to the clipboard.'
  }])
  orchestrator.destroy()
})

test('output target is captured before kernel processing starts', async () => {
  const recording = { id: 'rec-order', path: '/tmp/rec-order.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const order = []
  const kernel = new FakeKernel()
  const originalRun = kernel.run.bind(kernel)
  kernel.run = async (recordingArg, signal) => {
    order.push('kernel')
    return await originalRun(recordingArg, signal)
  }
  const output = new FakePaster()
  output.captureFocusedWindow = () => order.push('capture')

  const { orchestrator } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel,
    output
  })

  orchestrator.begin()
  await orchestrator.end()
  expectEqual(order, ['capture', 'kernel'])
  orchestrator.destroy()
})

test('short tap returns to idle without processing, history, or notification', async () => {
  const { orchestrator, kernel, output, history, notifier, state } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeShortTap(210) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(kernel.calls, [])
  expectEqual(output.writes, [])
  expectEqual(history.appends, [])
  expectEqual(notifier.notifications, [])
  expectEqual(state.events.filter(event => event.state === 'idle').length, 1)
  orchestrator.destroy()
})

test('capture failure is presented without creating history', async () => {
  const { orchestrator, history, notifier, state } = makeOrchestrator({
    recorder: new FakeRecorder({
      recording: recordingOutcomeCaptureFailure(new Error('pw-record exited unexpectedly'))
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(history.appends, [])
  expectEqual(state.events.filter(event => event.state === 'error').length, 1)
  expectEqual(notifier.notifications[0]?.title, 'Recording failed')
  expectEqual(notifier.notifications[0]?.body, 'Check that your microphone is available.')
  orchestrator.destroy()
})

test('processing failure persists raw diagnostics but presents category guidance', async () => {
  const recording = { id: 'rec-auth', path: '/tmp/rec-auth.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const error = Object.assign(new Error('HTTP 401: unauthorized token detail'), { category: 'authentication' })
  const { orchestrator, notifier, history } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ error })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(notifier.notifications, [{
    title: 'Provider authentication failed',
    body: 'Check your API key in Settings.'
  }])
  expectEqual(history.appends.length, 1)
  expectEqual(history.appends[0].status, 'error')
  expectEqual(history.appends[0].transcribe.error.code, 'authentication')
  expectEqual(history.appends[0].transcribe.error.message.includes('401'), true)
  orchestrator.destroy()
})

test('cancelled processing is quiet and does not persist', async () => {
  const recording = { id: 'rec-cancelled', path: '/tmp/rec-cancelled.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const error = Object.assign(new Error('Request was cancelled'), { category: 'cancelled' })
  const { orchestrator, notifier, history, output } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ error })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(notifier.notifications, [])
  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(output.writes, [])
  orchestrator.destroy()
})

test('refine fallback remains a successful delivery with a soft warning', async () => {
  const recording = { id: 'rec-refine', path: '/tmp/rec-refine.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, history, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({
      text: 'primary text',
      warning: { type: 'refine-failed', provider: 'mimo', message: 'refine provider down' }
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(history.appends[0].status, 'ok')
  expectEqual(notifier.notifications[0].title, 'Inserted the transcription')
  orchestrator.destroy()
})

test('cancellation during processing aborts the attempt and deletes only live-owned audio', async () => {
  const recording = { id: 'rec-processing', path: '/tmp/rec-processing.wav', durationMs: 5000, mimeType: 'audio/wav' }
  const { orchestrator, kernel, history, output } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ delayMs: 50 })
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  await waitFor(() => kernel.receivedSignals.length > 0)
  const signal = kernel.receivedSignals[0]
  orchestrator.cancel()
  await pending

  expectEqual(signal.aborted, true)
  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(output.writes, [])
  orchestrator.destroy()
})

test('cancel before stop yields no failure or history', async () => {
  const recorder = new FakeRecorder({
    recording: recordingOutcomeOk({ id: 'rec-stop', path: '/tmp/rec-stop.wav', durationMs: 4000, mimeType: 'audio/wav' })
  })
  const { orchestrator, history, notifier } = makeOrchestrator({ recorder })

  orchestrator.begin()
  const pending = orchestrator.end()
  orchestrator.cancel()
  recorder.recording = recordingOutcomeCancelled()
  await pending

  expectEqual(history.appends, [])
  expectEqual(notifier.notifications, [])
  orchestrator.destroy()
})

test('double stop is idempotent', async () => {
  const recording = { id: 'rec-double', path: '/tmp/rec-double.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, recorder, kernel } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  await orchestrator.end()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(kernel.calls.length, 1)
  orchestrator.destroy()
})

test('private mode is snapshotted when the live run begins', async () => {
  const recording = { id: 'rec-private', path: '/tmp/rec-private.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const settings = new FakeSettings({ 'private-mode': true })
  const { orchestrator, history, output, overlay } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    settings
  })

  orchestrator.begin()
  settings.set_boolean('private-mode', false)
  await orchestrator.end()

  expectEqual(output.writes, ['hello'])
  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(overlay.privateFlags.at(-1), true)
  orchestrator.destroy()
})

test('history owns a successful recording before output starts', async () => {
  const recording = { id: 'rec-owned', path: '/tmp/rec-owned.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const output = new FakePaster({ delayMs: 1 })
  const { orchestrator, history, state } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    output
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  await waitFor(() => state.events.some(event => event.state === 'outputting'))
  expectEqual(history.appends.length, 1)

  orchestrator.cancel()
  output.resolveWrite?.()
  await pending

  // Cancellation after persistence must not delete the WAV History references.
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

test('output failure does not create a second processing history row', async () => {
  const recording = { id: 'rec-output-error', path: '/tmp/rec-output-error.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, history, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    output: new FakePaster({ error: new Error('virtual keyboard unavailable') })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(history.appends.length, 1)
  expectEqual(history.appends[0].status, 'ok')
  expectEqual(history.discarded, [])
  expectEqual(notifier.notifications.at(-1).title, 'Text delivery failed')
  orchestrator.destroy()
})

test('destroy aborts processing and deletes live-owned recording only', async () => {
  const recording = { id: 'rec-destroy', path: '/tmp/rec-destroy.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, kernel, history } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ delayMs: 100 })
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  await waitFor(() => kernel.receivedSignals.length > 0)
  const signal = kernel.receivedSignals[0]
  orchestrator.destroy()

  expectEqual(signal.aborted, true)
  expectEqual(history.discarded, [recording])
  await pending.catch(() => {})
})

await run()
