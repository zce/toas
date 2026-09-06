import {
  AudioRecorder,
  DEFAULT_MINIMUM_RECORDING_DURATION_MS,
  RecorderOutcomeKind,
  resolveMinimumRecordingDuration
} from '../host/audio.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeHistory, FakeKernel, FakeNotifier, FakeOverlay, FakePaster, FakeRecorder } from './fakes.js'
import { test, expectEqual, run } from './harness.js'

function stoppedRecorderForDuration (durationMs, {
  sampleRate = 16000,
  minimumDurationMs = DEFAULT_MINIMUM_RECORDING_DURATION_MS
} = {}) {
  const recorder = new AudioRecorder({
    recordingsDirectory: '/tmp/x',
    sampleRate,
    minimumDurationMs
  })
  recorder._process = { send_signal () {} }
  recorder._readPromise = Promise.resolve()
  recorder._totalBytes = Math.round(recorder._bytesPerMs * durationMs)
  recorder._output = { seek () {}, write_all () {}, close () {} }
  return recorder
}

test('minimum recording duration defaults to 600 ms', () => {
  expectEqual(DEFAULT_MINIMUM_RECORDING_DURATION_MS, 600)
  expectEqual(resolveMinimumRecordingDuration({}), 600)
  expectEqual(new AudioRecorder({ recordingsDirectory: '/tmp/x' })._minimumDurationMs, 600)
})

test('recordings below the default threshold are short taps', async () => {
  expectEqual((await stoppedRecorderForDuration(500).stop()).kind, RecorderOutcomeKind.SHORT_TAP)
})

test('recordings at the default threshold are accepted', async () => {
  expectEqual((await stoppedRecorderForDuration(600).stop()).kind, RecorderOutcomeKind.OK)
})

test('recorder uses a configured threshold instead of the default', async () => {
  const below = await stoppedRecorderForDuration(700, { minimumDurationMs: 800 }).stop()
  const above = await stoppedRecorderForDuration(900, { minimumDurationMs: 800 }).stop()
  expectEqual(below.kind, RecorderOutcomeKind.SHORT_TAP)
  expectEqual(above.kind, RecorderOutcomeKind.OK)
})

test('minimum duration keeps time semantics at another sample rate', async () => {
  const recorder = stoppedRecorderForDuration(600, { sampleRate: 48000 })
  expectEqual(recorder._minimumBytes, 57600)
  expectEqual((await recorder.stop()).kind, RecorderOutcomeKind.OK)
})

test('host resolves configured duration before constructing the recorder', () => {
  let receivedDuration = null
  const recorder = new FakeRecorder()
  const orchestrator = new ToasOrchestrator({
    settings: {
      get_boolean: () => false,
      get_string: () => 'standard',
      get_uint: key => key === 'minimum-recording-duration' ? 800 : 0
    },
    history: new FakeHistory(),
    kernel: new FakeKernel(),
    output: new FakePaster(),
    overlay: new FakeOverlay(),
    notifier: new FakeNotifier(),
    recorderFactory: options => {
      receivedDuration = options.minimumDurationMs
      return recorder
    }
  })

  orchestrator.begin()
  expectEqual(receivedDuration, 800)
  orchestrator.cancel()
  orchestrator.destroy()
})

await run()
