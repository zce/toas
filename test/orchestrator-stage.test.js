// Overlay stage sequencing across a live voice input.

import { recordingOutcomeOk } from '../host/audio.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeHistory, FakeNotifier, FakeOverlay, FakePaster, FakeRecorder } from './fakes.js'
import { expectEqual, run, test } from './harness.js'

class FakeSettings {
  constructor() {
    this.values = {
      'private-mode': false,
      'auto-paste': true,
      'audio-quality': 'standard',
      'minimum-recording-duration': 600
    }
  }

  get_boolean(key) {
    return Boolean(this.values[key])
  }
  get_string(key) {
    return String(this.values[key] ?? '')
  }
  get_uint(key) {
    return Number(this.values[key] ?? 0)
  }
}

class StageKernel {
  async run(_recording, _signal, onStage) {
    onStage?.('refine')
    return {
      text: 'refined text',
      trace: [],
      warning: null
    }
  }
}

test('live overlay follows recording, transcription, refine, and insertion stages', async () => {
  const recording = {
    id: 'rec-stage',
    path: '/tmp/rec-stage.wav',
    durationMs: 1000,
    mimeType: 'audio/wav'
  }
  const overlay = new FakeOverlay()
  const orchestrator = new ToasOrchestrator({
    settings: new FakeSettings(),
    history: new FakeHistory(),
    kernel: new StageKernel(),
    output: new FakePaster(),
    overlay,
    notifier: new FakeNotifier(),
    recorderFactory: () => new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(
    overlay.states.map(entry => entry.state),
    ['recording', 'transcribing', 'refining', 'outputting', 'idle']
  )
  orchestrator.destroy()
})

await run()
