import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeRecorder, FakeKernel, FakePaster, FakeHistory, FakeOverlay, FakeNotifier } from './fakes.js'
import { recordingOutcomeOk, recordingOutcomeShortTap, recordingOutcomeCaptureFailure, recordingOutcomeCancelled } from '../host/audio.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

function makeOrchestrator ({
  recorder = new FakeRecorder(),
  kernel = new FakeKernel(),
  paster = new FakePaster(),
  history = new FakeHistory(),
  overlay = new FakeOverlay(),
  notifier = new FakeNotifier(),
  settings = {},
  privacy = { enabled: false },
  recorderFactory = null
} = {}) {
  const run = new class RunSpy {
    constructor () { this.events = [] }
    onState (state, message) { this.events.push({ state, message: message ?? '' }) }
  }()

  const orchestrator = new ToasOrchestrator({
    settings,
    collaborators: {
      recorderFactory: recorderFactory ?? (() => recorder),
      history,
      kernel,
      paster,
      overlay,
      notifier,
      privacy
    },
    onStateChanged: (state, message) => run.onState(state, message)
  })

  return { orchestrator, recorder, kernel, paster, history, overlay, notifier, privacy, run }
}

// Small helper for tests that need to wait for a condition before asserting.
function waitFor (predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) { return resolve() }
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error('waitFor timed out'))
      }
      setTimeout(check, 5)
    }
    check()
  })
}

test('orchestrator accepts injected collaborators', () => {
  const { orchestrator, recorder } = makeOrchestrator()

  expectTruthy(orchestrator)
  expectEqual(recorder.starts, 0)
  orchestrator.destroy()
})

test('missing kernel collaborator throws at construction', () => {
  let threw = null
  try {
    new ToasOrchestrator({
      settings: {},
      collaborators: {
        recorderFactory: () => new FakeRecorder(),
        history: new FakeHistory(),
        paster: new FakePaster(),
        overlay: new FakeOverlay(),
        notifier: new FakeNotifier()
        // kernel intentionally missing
      }
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.message.includes('kernel'), true)
})

test('recording quality reaches the recorder factory', () => {
  let receivedRate = null
  const recorder = new FakeRecorder()
  const { orchestrator } = makeOrchestrator({
    recorder,
    settings: { get_enum: () => 1 },
    recorderFactory: (_directory, _onLevel, _onError, sampleRate) => {
      receivedRate = sampleRate
      return recorder
    }
  })

  orchestrator.begin()
  expectEqual(receivedRate, 48000)
  orchestrator.cancel()
  orchestrator.destroy()
})

test('starting a recording resets the overlay waveform', () => {
  const { orchestrator, overlay } = makeOrchestrator()

  orchestrator.begin()

  expectEqual(overlay.resets, 1)
  orchestrator.destroy()
})

test('normal session runs recording through idle with one terminal transition', async () => {
  const recording = { id: 'rec-1', path: '/tmp/rec-1.wav', durationMs: 4200, mimeType: 'audio/wav' }
  const { orchestrator, recorder, kernel, paster, history, overlay, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  expectEqual(run.events[0], { state: 'recording', message: '' })
  await orchestrator.end()

  expectEqual(recorder.starts, 1)
  expectEqual(recorder.stops, 1)
  expectEqual(kernel.calls.length, 1)
  expectEqual(paster.writes, ['hello'])
  expectEqual(history.appends.length, 1)
  expectEqual(history.appends[0].status, 'ok')
  expectEqual(history.appends[0].text, 'hello')
  expectEqual(history.appends[0].trace[0].provider, 'fake')
  expectEqual(history.discarded, [])
  expectEqual(overlay.destroys, 0)

  const terminal = run.events.filter(e => e.state === 'idle' || e.state === 'error')
  expectEqual(terminal.length, 1)
  expectEqual(terminal[0].state, 'idle')
  orchestrator.destroy()
})

test('automatic insert success uses the outputting state', async () => {
  const recording = { id: 'rec-insert', path: '/tmp/rec-insert.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, run, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    paster: new FakePaster({ deliveryMode: 'insert' })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(run.events.some(event => event.state === 'outputting'), true)
  expectEqual(run.events.some(event => event.state === 'copying'), false)
  expectEqual(notifier.notifications, [])
  orchestrator.destroy()
})

test('clipboard-only success uses copying state without fallback notification', async () => {
  const recording = { id: 'rec-copy', path: '/tmp/rec-copy.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, run, notifier, paster } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    paster: new FakePaster({ deliveryMode: 'clipboard' })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(paster.writes, ['hello'])
  expectEqual(run.events.some(event => event.state === 'copying'), true)
  expectEqual(run.events.some(event => event.state === 'outputting'), false)
  expectEqual(notifier.notifications, [])
  orchestrator.destroy()
})

test('target-window mismatch keeps insert intent but notifies clipboard fallback', async () => {
  const recording = { id: 'rec-focus', path: '/tmp/rec-focus.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const fallback = 'The target window changed, so your text was copied to the clipboard.'
  const { orchestrator, run, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    paster: new FakePaster({ deliveryMode: 'insert', focusMismatchMessage: fallback })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(run.events.some(event => event.state === 'outputting'), true)
  expectEqual(notifier.notifications, [{ title: 'Copied to clipboard', body: fallback }])
  orchestrator.destroy()
})

test('output target is captured before kernel processing starts', async () => {
  const recording = { id: 'rec-order', path: '/tmp/rec-order.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const order = []
  const kernel = new FakeKernel()
  const originalRun = kernel.run.bind(kernel)
  kernel.run = async (recordingArg, signal) => {
    order.push('kernel')
    return originalRun(recordingArg, signal)
  }
  const paster = new FakePaster()
  paster.captureFocusedWindow = () => order.push('capture')

  const { orchestrator } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel,
    paster
  })

  orchestrator.begin()
  await orchestrator.end()

  // The window focused when recording stopped is locked before any async
  // preparation (audio loading, config snapshot) can run.
  expectEqual(order, ['capture', 'kernel'])
  orchestrator.destroy()
})

test('destroy aborts in-flight kernel work but leaves collaborator teardown to the owner', async () => {
  const recording = { id: 'rec-destroy', path: '/tmp/rec-destroy.wav', durationMs: 1000, mimeType: 'audio/wav' }
  const { orchestrator, recorder, paster, history, overlay, notifier, kernel } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ delayMs: 100 })
  })

  orchestrator.begin()
  const pending = orchestrator.end()

  // Wait until the kernel attempt actually started, then destroy mid-flight.
  await waitFor(() => kernel.receivedSignals.length > 0)
  const signal = kernel.receivedSignals[0]
  expectTruthy(signal)
  orchestrator.destroy()

  expectEqual(signal.aborted, true)
  // destroy() finishes the run itself; the recorder it created is torn down
  // with the attempt, while owned collaborators (overlay, paster, notifier)
  // are left to the composition root.
  expectEqual(overlay.destroys, 0)
  expectEqual(paster.destroys, 0)
  expectEqual(notifier.cancels, 0)
  await pending.catch(() => {})
})

test('short tap discards silently and returns to idle', async () => {
  const { orchestrator, recorder, kernel, paster, history, overlay, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeShortTap(210) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(kernel.calls.length, 0)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(notifier.notifications, [])

  const terminal = run.events.filter(e => e.state === 'idle' || e.state === 'error')
  expectEqual(terminal, [{ state: 'idle', message: '' }])
  orchestrator.destroy()
})

test('capture failure produces error state and notification', async () => {
  const { orchestrator, recorder, kernel, paster, history, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({
      recording: recordingOutcomeCaptureFailure(new Error('pw-record exited unexpectedly'))
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(kernel.calls.length, 0)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(run.events.filter(e => e.state === 'error').length, 1)
  expectEqual(notifier.notifications.length, 1)
  expectEqual(notifier.notifications[0]?.title, 'Recording failed')
  expectEqual(notifier.notifications[0]?.body, 'Check that your microphone is available.')
  orchestrator.destroy()
})

test('processing failure uses category guidance without raw provider detail', async () => {
  const recording = { id: 'rec-4', path: '/tmp/rec-4.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, notifier, run, history } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ error: Object.assign(new Error('HTTP 401: unauthorized token detail'), { category: 'authentication' }) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(run.events.filter(e => e.state === 'error').length, 1)
  expectEqual(run.events.find(e => e.state === 'error')?.message, 'Provider authentication failed')
  expectEqual(notifier.notifications, [{
    title: 'Provider authentication failed',
    body: 'Check your API key in Settings.'
  }])
  expectEqual(notifier.notifications[0].body.includes('401'), false)
  expectEqual(history.appends[0].error.category, 'authentication')
  expectEqual(history.appends[0].error.message.includes('401'), true)
  orchestrator.destroy()
})

test('cancelled processing error is not presented as a failure', async () => {
  const recording = { id: 'rec-cancelled-category', path: '/tmp/rec-cancelled-category.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, notifier, run, history, paster } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ error: Object.assign(new Error('Request was cancelled'), { category: 'cancelled' }) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(run.events.filter(e => e.state === 'error'), [])
  expectEqual(notifier.notifications, [])
  expectEqual(history.appends, [])
  expectEqual(paster.writes, [])
  orchestrator.destroy()
})

test('refine fallback notifies as a soft warning, session still succeeds', async () => {
  const recording = { id: 'rec-6', path: '/tmp/rec-6.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, paster, history, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({
      text: 'primary text',
      warning: { type: 'refine-failed', provider: 'mimo', message: 'refine provider down' }
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(paster.writes, ['primary text'])
  expectEqual(history.appends[0].status, 'ok')
  expectEqual(run.events.filter(e => e.state === 'error').length, 0)
  expectEqual(notifier.notifications.length, 1)
  expectEqual(notifier.notifications[0].title, 'Inserted the primary result')
  orchestrator.destroy()
})

test('clipboard-only refine fallback remains a successful copy with soft warning', async () => {
  const recording = { id: 'rec-6-copy', path: '/tmp/rec-6-copy.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, history, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    paster: new FakePaster({ deliveryMode: 'clipboard' }),
    kernel: new FakeKernel({
      text: 'primary text',
      warning: { type: 'refine-failed', provider: 'mimo', message: 'refine provider down' }
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(history.appends[0].status, 'ok')
  expectEqual(run.events.some(e => e.state === 'copying'), true)
  expectEqual(run.events.filter(e => e.state === 'error').length, 0)
  expectEqual(notifier.notifications[0].title, 'Copied the primary result')
  orchestrator.destroy()
})

test('clean success notifies nothing; cancel notifies nothing', async () => {
  const recording = { id: 'rec-7', path: '/tmp/rec-7.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const success = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })
  success.orchestrator.begin()
  await success.orchestrator.end()
  expectEqual(success.notifier.notifications, [])
  success.orchestrator.destroy()

  const cancelled = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })
  cancelled.orchestrator.begin()
  const pending = cancelled.orchestrator.end()
  cancelled.orchestrator.cancel()
  await pending
  expectEqual(cancelled.notifier.notifications, [])
  cancelled.orchestrator.destroy()

  const tap = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeShortTap(120) })
  })
  tap.orchestrator.begin()
  await tap.orchestrator.end()
  expectEqual(tap.notifier.notifications, [])
  tap.orchestrator.destroy()
})

test('cancellation during processing leaves no output or history', async () => {
  const recording = { id: 'rec-2', path: '/tmp/rec-2.wav', durationMs: 5000, mimeType: 'audio/wav' }
  const { orchestrator, recorder, paster, history, run, kernel } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ delayMs: 50 })
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  await waitFor(() => run.events.some(e => e.state === 'processing'))
  const signal = kernel.receivedSignals[0]
  expectTruthy(signal)
  orchestrator.cancel()
  expectEqual(signal.aborted, true)
  await pending

  expectEqual(recorder.starts, 1)
  expectEqual(recorder.cancels >= 1, true)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(run.events.filter(e => e.state === 'idle' || e.state === 'error').length, 1)
  orchestrator.destroy()
})

test('cancel before stop yields cancelled outcome, not an error', async () => {
  const { orchestrator, paster, history, notifier, run, recorder } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk({ id: 'rec-5', path: '/tmp/rec-5.wav', durationMs: 4000, mimeType: 'audio/wav' }) })
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  orchestrator.cancel()
  recorder.recording = recordingOutcomeCancelled()
  await pending

  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(notifier.notifications, [])
  expectEqual(run.events.filter(e => e.state === 'error').length, 0)
  expectEqual(run.events.filter(e => e.state === 'idle' || e.state === 'error').length, 1)
  orchestrator.destroy()
})

test('double stop is idempotent: second end() is a no-op', async () => {
  const recording = { id: 'rec-3', path: '/tmp/rec-3.wav', durationMs: 3000, mimeType: 'audio/wav' }
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

test('private voice input inserts text but keeps no history or recording', async () => {
  const recording = { id: 'rec-priv-1', path: '/tmp/rec-priv-1.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, paster, history, overlay, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    privacy: { enabled: true }
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(paster.writes, ['hello'])
  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(run.events.filter(e => e.state === 'error').length, 0)
  expectEqual(overlay.destroys, 0)
  orchestrator.destroy()
})

test('private voice input keeps no recording when processing fails', async () => {
  const recording = { id: 'rec-priv-2', path: '/tmp/rec-priv-2.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, paster, history, notifier } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    kernel: new FakeKernel({ error: new Error('HTTP 500: provider down') }),
    privacy: { enabled: true }
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(notifier.notifications.length, 1)
  orchestrator.destroy()
})

test('switching private mode off mid-run still retains the voice input', async () => {
  const recording = { id: 'rec-priv-3', path: '/tmp/rec-priv-3.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, paster, history, privacy } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  privacy.enabled = false
  orchestrator.begin()
  privacy.enabled = true
  await orchestrator.end()

  expectEqual(paster.writes, ['hello'])
  expectEqual(history.appends.length, 1)
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

test('switching private mode on mid-run still discards the voice input', async () => {
  const recording = { id: 'rec-priv-4', path: '/tmp/rec-priv-4.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, history, overlay, privacy } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  privacy.enabled = true
  orchestrator.begin()
  expectEqual(overlay.privateFlags.at(-1), true)
  privacy.enabled = false
  await orchestrator.end()

  expectEqual(history.appends, [])
  expectEqual(history.discarded, [recording])
  expectEqual(overlay.privateFlags.at(-1), true)
  orchestrator.destroy()
})

await run()
