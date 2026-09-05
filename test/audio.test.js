// AudioRecorder parameterization check: the configured sample rate flows
// into capture sizing. Pure GJS + GLib; no recording is started.
import { AudioRecorder, recordingIdForNow } from '../lib/infrastructure/audio.js'
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
  // Compact ISO 8601: 20260905T132500Z — the file name is the start time.
  expectEqual(/^\d{8}T\d{6}Z(-\d+)?$/.test(id), true)
  expectEqual(id.endsWith('Z') || /-\d+$/.test(id), true)
})

test('a same-second capture gets a unique id instead of colliding', () => {
  const a = recordingIdForNow()
  const b = recordingIdForNow()
  // Two calls within the same second must not produce the same file name:
  // Gio.File.replace would truncate the earlier recording.
  expectEqual(a === b, false)
  if (a.slice(0, 16) === b.slice(0, 16)) {
    // same second: the later one carries a counter suffix
    expectEqual(/-\d+$/.test(b), true)
  }
})

await run()
