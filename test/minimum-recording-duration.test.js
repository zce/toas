import {
  AudioRecorder,
  DEFAULT_MINIMUM_RECORDING_DURATION_MS,
  RecorderOutcomeKind,
  resolveMinimumRecordingDuration
} from '../host/audio.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import {
  FakeHistory,
  FakeKernel,
  FakeNotifier,
  FakeOverlay,
  FakePaster,
  FakeRecorder
} from './fakes.js'
import { test, expectEqual, run } from './harness.js'

function stoppedRecorderForDuration (durationMs, {
  sampleRate = 16000,
  minimumDurationMs = DEFAULT_MINIMUM_RECORDING_DURATION_MS
} = {}) {
  const recorder = new AudioRecorder(
    '/tmp/x',
    null,
    null,
    sampleRate,
    minimumDurationMs
  )
  recorder._process = { send_signal () {} }
  recorder._readPromise = Promise.resolve()
  recorder._totalBytes = Math.round(recorder._bytesPerMs * durationMs)
  recorder._output = {
    seek () {},
    write_all () {},
    close () {}
  }
  return recorder
}

test('minimum recording duration defaults to 600 ms', () => {
  expectEqual(DEFAULT_MINIMUM_RECORDING_DURATION_MS, 600)
  expectEqual(resolveMinimumRecordingDuration({}), 600)
  expectEqual(new AudioRecorder('/tmp/x', null, null)._minimumDurationMs, 600)
})

test('recordings below the default threshold are short taps', async () => {
  const outcome = await stoppedRecorderForDuration(500).stop()
  expectEqual(outcome.kind, RecorderOutcomeKind.SHORT_TAP)
})

test('recordings at the default threshold are accepted', async () => {
  const outcome = await stoppedRecorderForDuration(600).stop()
  expectEqual(outcome.kind, RecorderOutcomeKind.OK)
})

test('recorder uses a configured threshold instead of the default', async () => {
  const below = await stoppedRecorderForDuration(700, {
    minimumDurationMs: 800
  }).stop()
  const above = await stoppedRecorderForDuration(900, {
    minimumDurationMs: 800
  }).stop()

  expectEqual(below.kind, RecorderOutcomeKind.SHORT_TAP)
  expectEqual(above.kind, RecorderOutcomeKind.OK)
})

test('minimum duration keeps time semantics at another sample rate', async () => {
  const recorder = stoppedRecorderForDuration(600, { sampleRate: 48000 })
  expectEqual(recorder._minimumBytes, 57600)
  const outcome = await recorder.stop()
  expectEqual(outcome.kind, RecorderOutcomeKind.OK)
})

test('host resolves the configured duration before constructing the recorder', () => {
  let receivedDuration = null
  const recorder = new FakeRecorder()
  const orchestrator = new ToasOrchestrator({
    settings: {
      get_string: () => 'standard',
      get_uint: key => key === 'minimum-recording-duration' ? 800 : 0
    },
    collaborators: {
      recorderFactory: (
        _directory,
        _onLevel,
        _onError,
        _sampleRate,
        minimumDurationMs
      ) => {
        receivedDuration = minimumDurationMs
        return recorder
      },
      history: new FakeHistory(),
      kernel: new FakeKernel(),
      paster: new FakePaster(),
      overlay: new FakeOverlay(),
      notifier: new FakeNotifier()
    }
  })

  orchestrator.begin()
  expectEqual(receivedDuration, 800)
  orchestrator.cancel()
  orchestrator.destroy()
})

await run()
