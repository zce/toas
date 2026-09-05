// AudioRecorder parameterization check: the configured sample rate flows
// into capture sizing. Pure GJS + GLib; no recording is started.
import { AudioRecorder, recordingIdForNow } from '../host/audio.js'
import { test, expectEqual, run } from './harness.js'

test('recorder defaults to the standard capture rate', () => {
  const recorder = new AudioRecorder('/tmp/x', null, null)
  expectEqual(recorder._sampleRate, 16000)
  expectEqual(recorder._chunkBytes, 3200) // 100 ms of PCM16 @ 16 kHz mono
  expectEqual(recorder._bytesPerMs, 32) // 16000 Hz * 2 bytes / 1000 ms
  expectEqual(recorder._minimumBytes, 32000)
})

test('high quality preset uses 48 kHz capture sizing', () => {
  const recorder = new AudioRecorder('/tmp/x', null, null, 48000)
  expectEqual(recorder._sampleRate, 48000)
  expectEqual(recorder._chunkBytes, 9600) // 100 ms of PCM16 @ 48 kHz mono
  expectEqual(recorder._bytesPerMs, 96) // 48000 Hz * 2 bytes / 1000 ms
  expectEqual(recorder._minimumBytes, 96000)
})

test('zero or invalid rate falls back to standard', () => {
  expectEqual(new AudioRecorder('/tmp/x', null, null, 0)._sampleRate, 16000)
})

test('recording ids are UTC timestamp file names', () => {
  const id = recordingIdForNow()
  // Compact ISO 8601 with milliseconds: 20260905T132500123.
  expectEqual(/^\d{8}T\d{6}\d{3}$/.test(id), true)
  expectEqual(id.length, 18)
})

test('ids differ across different milliseconds', () => {
  const a = recordingIdForNow()
  // Recording starts are serial and always many milliseconds apart; the
  // guarantee is one id per millisecond, not per call. Advance past the
  // current millisecond so the second id is a genuinely different moment.
  const t = Date.now()
  while (Date.now() <= t) { /* spin to the next millisecond */ }
  const b = recordingIdForNow()
  expectEqual(a === b, false)
})

await run()
