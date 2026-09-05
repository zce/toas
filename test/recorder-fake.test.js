import { recordingOutcomeOk, recordingOutcomeShortTap, recordingOutcomeSizeLimit, recordingOutcomeCancelled, RecorderOutcomeKind } from '../lib/audio.js'
import { FakeRecorder } from './fakes.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const recording = { id: 'r', path: '/tmp/r.wav', durationMs: 3000, mimeType: 'audio/wav' }

test('fake recorder returns its configured outcome once', async () => {
  const recorder = new FakeRecorder({ recording: recordingOutcomeOk(recording) })

  const first = await recorder.stop()
  const second = await recorder.stop()

  expectEqual(first, recordingOutcomeOk(recording))
  expectEqual(second, first)
  expectEqual(recorder.stops, 2)
})

test('outcome kinds partition the terminal states', () => {
  expectEqual(recordingOutcomeOk(recording).kind, RecorderOutcomeKind.OK)
  expectEqual(recordingOutcomeShortTap(0).kind, RecorderOutcomeKind.SHORT_TAP)
  expectEqual(recordingOutcomeSizeLimit(recording).kind, RecorderOutcomeKind.SIZE_LIMIT)
  expectEqual(recordingOutcomeCancelled().kind, RecorderOutcomeKind.CANCELLED)
  expectTruthy(RecorderOutcomeKind.CAPTURE_FAILURE)
})

test('fake recorder surfaces stop errors for the failure path', async () => {
  const boom = new Error('device vanished')
  const recorder = new FakeRecorder({ stopError: boom })

  let caught = null
  try {
    await recorder.stop()
  } catch (error) {
    caught = error
  }

  expectEqual(caught, boom)
})

await run()
