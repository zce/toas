// Overlay monitor pinning while a live run is in progress.

import { recordingOutcomeOk } from '../host/audio.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeHistory, FakeKernel, FakeNotifier, FakeOverlay, FakePaster, FakeRecorder } from './fakes.js'
import { expectEqual, run, test } from './harness.js'

function makeOrchestrator({ monitorIndex = null } = {}) {
  const recording = {
    id: 'monitor-test',
    path: '/tmp/monitor-test.wav',
    durationMs: 1000,
    mimeType: 'audio/wav'
  }
  const recorder = new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  const paster = new FakePaster()
  const overlay = new FakeOverlay()
  const monitorCalls = []
  let focusedMonitorIndex = monitorIndex

  paster.getFocusedMonitorIndex = () => focusedMonitorIndex
  overlay.setMonitor = index => monitorCalls.push(index)

  const orchestrator = new ToasOrchestrator({
    settings: {},
    history: new FakeHistory(),
    kernel: new FakeKernel(),
    output: paster,
    overlay,
    notifier: new FakeNotifier(),
    recorderFactory: () => recorder
  })

  return {
    orchestrator,
    paster,
    monitorCalls,
    setFocusedMonitorIndex: value => {
      focusedMonitorIndex = value
    }
  }
}

test('run pins the focused monitor when recording begins', async () => {
  const session = makeOrchestrator({ monitorIndex: 1 })

  session.orchestrator.begin()
  expectEqual(session.monitorCalls, [1])

  // Changing focus later must not select another overlay monitor. Output still
  // performs its separate target capture when recording ends.
  session.setFocusedMonitorIndex(0)
  await session.orchestrator.end()

  expectEqual(session.monitorCalls, [1])
  expectEqual(session.paster.capturedWindows.length, 1)
  session.orchestrator.destroy()
})

test('unavailable focused monitor requests primary fallback', () => {
  const session = makeOrchestrator({ monitorIndex: null })

  session.orchestrator.begin()
  expectEqual(session.monitorCalls, [null])

  session.orchestrator.cancel()
  session.orchestrator.destroy()
})

await run()
