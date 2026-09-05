import {
  RecorderOutcomeKind,
  recordingOutcomeOk,
  recordingOutcomeShortTap,
  recordingOutcomeSizeLimit,
  recordingOutcomeCancelled
} from '../lib/infrastructure/recorder-outcome.js'
import { test, expectEqual, run } from './harness.js'

test('size limit outcome carries a valid capped recording', () => {
  const recording = { id: 'lim-1', path: '/tmp/lim-1.wav', durationMs: 780000, mimeType: 'audio/wav' }
  const outcome = recordingOutcomeSizeLimit(recording)

  expectEqual(outcome.kind, RecorderOutcomeKind.SIZE_LIMIT)
  expectEqual(outcome.recording, recording)
  expectEqual(outcome.error, null)
})

test('cancelled outcome carries nothing', () => {
  const outcome = recordingOutcomeCancelled()

  expectEqual(outcome.kind, RecorderOutcomeKind.CANCELLED)
  expectEqual(outcome.recording, null)
  expectEqual(outcome.error, null)
})

await run()
