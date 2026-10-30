// AudioRecorder parameterization check: configured capture settings flow
// into byte sizing. Pure GJS + GLib; no recording is started.
import { AudioRecorder, recordingIdForNow } from '../host/audio.js'
import { expectEqual, run, test } from './harness.js'

function recorder(options = {}) {
  return new AudioRecorder({ recordingsDirectory: '/tmp/x', ...options })
}

test('recorder defaults to standard capture and 600 ms cutoff', () => {
  const value = recorder()
  expectEqual(value._sampleRate, 16000)
  expectEqual(value._chunkBytes, 3200)
  expectEqual(value._bytesPerMs, 32)
  expectEqual(value._minimumDurationMs, 600)
  expectEqual(value._minimumBytes, 19200)
})

test('48 kHz capture keeps the cutoff expressed as time', () => {
  const value = recorder({ sampleRate: 48000 })
  expectEqual(value._sampleRate, 48000)
  expectEqual(value._chunkBytes, 9600)
  expectEqual(value._bytesPerMs, 96)
  expectEqual(value._minimumDurationMs, 600)
  expectEqual(value._minimumBytes, 57600)
})

test('zero or invalid constructor values fall back to defaults', () => {
  expectEqual(recorder({ sampleRate: 0 })._sampleRate, 16000)
  expectEqual(recorder({ minimumDurationMs: Number.NaN })._minimumDurationMs, 600)
})

test('recording ids are UTC timestamp file names', () => {
  const id = recordingIdForNow()
  expectEqual(/^\d{8}T\d{6}\d{3}$/.test(id), true)
  expectEqual(id.length, 18)
})

test('ids differ across different milliseconds', () => {
  const a = recordingIdForNow()
  const t = Date.now()
  while (Date.now() <= t) {
    /* spin to the next millisecond */
  }
  const b = recordingIdForNow()
  expectEqual(a === b, false)
})

test('muted capture drops cue-period PCM and unmute resumes writing', async () => {
  const value = recorder({ captureInitiallyMuted: true })
  const writes = []
  value._output = { write_all: data => writes.push(data.length) }
  value._totalBytes = 0
  let count = 0
  const bytes = new Uint8Array(value._chunkBytes)
  value._stream = {
    read_bytes_async: async () => {
      if (count++ === 0) return { get_size: () => bytes.length, get_data: () => bytes }
      return { get_size: () => 0 }
    }
  }
  await value._readLoop()
  expectEqual(value._totalBytes, 0)
  expectEqual(writes.length, 0)
  value.unmute()
  count = 0
  await value._readLoop()
  expectEqual(value._totalBytes, bytes.length)
  expectEqual(writes.length, 1)
})

test('stop closes the capture gate before signalling the recorder', async () => {
  const value = recorder()
  let captureDuringSignal = null
  value._process = { send_signal: () => { captureDuringSignal = value._captureEnabled } }
  value._readPromise = Promise.resolve()
  value._path = null
  value._totalBytes = 0
  const outcome = await value.stop()
  expectEqual(captureDuringSignal, false)
  expectEqual(outcome.kind, 'short-tap')
})

await run()
