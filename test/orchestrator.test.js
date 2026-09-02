import { ToasOrchestrator } from '../lib/orchestrator.js'
import { FakeRecorder, FakeTranscriber, FakeRefiner, FakePaster, FakeHistory, FakeOverlay, FakeNotifier } from './fakes.js'
import { recordingOutcomeOk, recordingOutcomeShortTap, recordingOutcomeCaptureFailure } from '../lib/recorder-outcome.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

function makeOrchestrator ({
  recorder = new FakeRecorder(),
  transcriber = new FakeTranscriber(),
  refiner = new FakeRefiner(),
  paster = new FakePaster(),
  history = new FakeHistory(),
  overlay = new FakeOverlay(),
  notifier = new FakeNotifier()
} = {}) {
  const run = new class RunSpy {
    constructor () { this.events = [] }
    onState (state, message) { this.events.push({ state, message: message ?? '' }) }
  }()

  const orchestrator = new ToasOrchestrator({
    settings: {},
    collaborators: {
      recorderFactory: () => recorder,
      history,
      transcriber,
      refiner,
      paster,
      overlay,
      notifier
    },
    onStateChanged: (state, message) => run.onState(state, message)
  })

  return { orchestrator, recorder, transcriber, refiner, paster, history, overlay, notifier, run }
}

test('orchestrator accepts injected collaborators', () => {
  const { orchestrator, recorder } = makeOrchestrator()

  expectTruthy(orchestrator)
  expectEqual(recorder.starts, 0)
  orchestrator.destroy()
})

test('normal session runs recording through idle with one terminal transition', async () => {
  const recording = { id: 'rec-1', path: '/tmp/rec-1.wav', durationMs: 4200, mimeType: 'audio/wav' }
  const { orchestrator, recorder, paster, history, overlay, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  expectEqual(run.events[0], { state: 'recording', message: '' })
  await orchestrator.end()

  expectEqual(recorder.starts, 1)
  expectEqual(recorder.stops, 1)
  expectEqual(paster.writes, ['HELLO'])
  expectEqual(history.appends.length, 1)
  expectEqual(history.appends[0].status, 'ok')
  expectEqual(history.discarded, [])
  expectEqual(overlay.destroys, 0)

  const terminal = run.events.filter(e => e.state === 'idle' || e.state === 'error')
  expectEqual(terminal.length, 1)
  expectEqual(terminal[0].state, 'idle')
  orchestrator.destroy()
})

test('short tap discards silently and returns to idle', async () => {
  const { orchestrator, recorder, paster, history, overlay, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeShortTap(210) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(notifier.notifications, [])

  const terminal = run.events.filter(e => e.state === 'idle' || e.state === 'error')
  expectEqual(terminal, [{ state: 'idle', message: '' }])
  orchestrator.destroy()
})

test('capture failure produces error state and notification', async () => {
  const { orchestrator, recorder, paster, history, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({
      recording: recordingOutcomeCaptureFailure(new Error('pw-record exited unexpectedly'))
    })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(run.events.filter(e => e.state === 'error').length, 1, 'exactly one error state')
  expectEqual(notifier.notifications.length, 1, 'exactly one notification')
  expectEqual(notifier.notifications[0]?.title, 'Recording failed', 'failure notification title')
  orchestrator.destroy()
})

test('transcription failure notifies once with the error detail', async () => {
  const recording = { id: 'rec-4', path: '/tmp/rec-4.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, notifier, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    transcriber: new FakeTranscriber({ error: new Error('HTTP 401: unauthorized') })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(run.events.filter(e => e.state === 'error').length, 1)
  expectEqual(notifier.notifications.length, 1)
  expectEqual(notifier.notifications[0].title, 'Voice input failed')
  expectEqual(notifier.notifications[0].body.includes('401'), true)
  orchestrator.destroy()
})

test('cancellation during processing leaves no output or history', async () => {
  const recording = { id: 'rec-2', path: '/tmp/rec-2.wav', durationMs: 5000, mimeType: 'audio/wav' }
  const { orchestrator, recorder, transcriber, paster, history, run } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
    transcriber: new FakeTranscriber({ delayMs: 50 })
  })

  orchestrator.begin()
  const pending = orchestrator.end()
  expectEqual(run.events.some(e => e.state === 'transcribing'), true)
  orchestrator.cancel()
  await pending

  expectEqual(recorder.starts, 1)
  expectEqual(recorder.stops, 1)
  expectEqual(transcriber.cancels >= 1, true)
  expectEqual(paster.writes, [])
  expectEqual(history.appends, [])
  expectEqual(run.events.filter(e => e.state === 'idle' || e.state === 'error').length, 1)
  orchestrator.destroy()
})

test('double stop is idempotent: second end() is a no-op', async () => {
  const recording = { id: 'rec-3', path: '/tmp/rec-3.wav', durationMs: 3000, mimeType: 'audio/wav' }
  const { orchestrator, recorder, paster } = makeOrchestrator({
    recorder: new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  await orchestrator.end()
  await orchestrator.end()

  expectEqual(recorder.stops, 1)
  expectEqual(paster.writes.length, 1)
  orchestrator.destroy()
})

await run()