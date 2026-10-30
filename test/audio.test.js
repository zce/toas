// AudioRecorder sizing and PCM lifecycle checks. Capture is never started.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { AUDIO_QUALITY_PRESETS, AudioRecorder, recordingIdForNow } from '../host/audio.js'
import { wavHeader } from '../host/wav.js'
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

test('mono s16 WAV headers preserve sizes at every capture rate', () => {
  for (const { sampleRate } of Object.values(AUDIO_QUALITY_PRESETS)) {
    const pcmBytes = sampleRate * 2
    const header = wavHeader(pcmBytes, sampleRate)
    const view = new DataView(header.buffer)

    expectEqual(header.length, 44)
    expectEqual(String.fromCharCode(...header.slice(0, 4)), 'RIFF')
    expectEqual(view.getUint32(4, true), 36 + pcmBytes)
    expectEqual(String.fromCharCode(...header.slice(8, 16)), 'WAVEfmt ')
    expectEqual(view.getUint32(16, true), 16)
    expectEqual(view.getUint16(20, true), 1)
    expectEqual(view.getUint16(22, true), 1)
    expectEqual(view.getUint32(24, true), sampleRate)
    expectEqual(view.getUint32(28, true), sampleRate * 2)
    expectEqual(view.getUint16(32, true), 2)
    expectEqual(view.getUint16(34, true), 16)
    expectEqual(String.fromCharCode(...header.slice(36, 40)), 'data')
    expectEqual(view.getUint32(40, true), pcmBytes)
  }
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
      if (count++ === 0) {
        return { get_size: () => bytes.length, get_data: () => bytes }
      }
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

test('a read requested before the sound gate opens is never accepted later', async () => {
  const value = recorder({ captureInitiallyMuted: true })
  const writes = []
  value._output = { write_all: data => writes.push(data.length) }
  value._totalBytes = 0
  const data = new Uint8Array(value._chunkBytes)
  let release
  let calls = 0
  value._stream = {
    read_bytes_async: async () => {
      if (calls++ === 0) {
        return new Promise(resolve => {
          release = () => resolve({
            get_size: () => data.length,
            get_data: () => data
          })
        })
      }

      return { get_size: () => 0 }
    }
  }
  const reading = value._readLoop()
  value.unmute()
  release()
  await reading
  expectEqual(value._totalBytes, 0)
  expectEqual(writes, [])
})

test('stop preserves buffered tail PCM in the completed WAV', async () => {
  const value = recorder({ minimumDurationMs: 200 })
  const captured = new Uint8Array(value._chunkBytes).fill(0x11)
  const tail = new Uint8Array(value._chunkBytes).fill(0x22)
  const output = Gio.MemoryOutputStream.new_resizable()
  output.write_all(new Uint8Array(44), null)
  output.write_all(captured, null)
  value._output = output
  value._totalBytes = captured.length
  let signalled = false
  let releaseTail
  let reads = 0
  value._process = {
    send_signal: signal => {
      expectEqual(signal, 2)
      signalled = true
    }
  }
  value._stream = {
    read_bytes_async: async () => {
      if (reads++ === 0) {
        return new Promise(resolve => { releaseTail = () => resolve(new GLib.Bytes(tail)) })
      }
      return new GLib.Bytes(new Uint8Array())
    }
  }
  value._readPromise = value._readLoop()
  value._path = null

  const pending = value.stop()
  expectEqual(signalled, true)
  expectEqual(output.is_closed(), false)
  releaseTail()
  const outcome = await pending
  expectEqual(outcome.kind, 'ok')
  expectEqual(outcome.recording.durationMs, 200)
  expectEqual(value._captureEnabled, false)
  const wav = output.steal_as_bytes().get_data()
  const header = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  expectEqual(header.getUint32(40, true), captured.length + tail.length)
  expectEqual(Array.from(wav.slice(44)), [...captured, ...tail])
})

await run()
