import {
  RecorderOutcomeKind,
  recordingOutcomeOk,
  recordingOutcomeShortTap,
  recordingOutcomeCaptureFailure,
  RecorderOutcomeError
} from '../recorder-outcome.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

test('ok outcome carries the recording', () => {
  const recording = { id: 'r1', path: '/tmp/r1.wav', durationMs: 4200 }
  const outcome = recordingOutcomeOk(recording)

  expectEqual(outcome.kind, RecorderOutcomeKind.OK)
  expectEqual(outcome.recording, recording)
  expectEqual(outcome.error, null)
})

test('short tap outcome carries duration but no recording', () => {
  const outcome = recordingOutcomeShortTap(320)

  expectEqual(outcome.kind, RecorderOutcomeKind.SHORT_TAP)
  expectEqual(outcome.recording, null)
  expectEqual(outcome.durationMs, 320)
})

test('capture failure outcome carries the underlying error', () => {
  const cause = new Error('pw-record exited unexpectedly')
  const outcome = recordingOutcomeCaptureFailure(cause)

  expectEqual(outcome.kind, RecorderOutcomeKind.CAPTURE_FAILURE)
  expectEqual(outcome.recording, null)
  expectEqual(outcome.error, cause)
})

test('outcome error exposes the outcome for classification', () => {
  const outcome = recordingOutcomeShortTap(210)
  const error = new RecorderOutcomeError(outcome)

  expectTruthy(error instanceof Error)
  expectEqual(error.outcome.kind, RecorderOutcomeKind.SHORT_TAP)
})

await run()
