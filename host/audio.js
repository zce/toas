import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

// Effective configuration resolution for audio quality. Pure data: no GI
// dependencies in this section.

// Recording quality presets. The preset chooses the capture sample rate;
// mono s16 stays fixed. Higher rates produce larger uploads and hit the
// recording size cap sooner (see MAX_PCM_BYTES below).
export const AUDIO_QUALITY_PRESETS = {
  minimum: { sampleRate: 8000 },
  low: { sampleRate: 12000 },
  standard: { sampleRate: 16000 },
  high: { sampleRate: 24000 },
  maximum: { sampleRate: 48000 }
}

// Sample rate used when the stored quality value predates the setting or is
// otherwise unknown; matches the format every existing recording uses.
export const DEFAULT_SAMPLE_RATE = AUDIO_QUALITY_PRESETS.standard.sampleRate

export function resolveSampleRate (settings) {
  const quality = settings.get_string?.('audio-quality') ?? 'standard'
  const preset = AUDIO_QUALITY_PRESETS[quality] ?? AUDIO_QUALITY_PRESETS.standard
  return preset.sampleRate
}

// Structured recorder outcomes. A recording ends for exactly one reason;
// callers classify outcomes instead of parsing error message strings.

export const RecorderOutcomeKind = {
  OK: 'ok',
  SHORT_TAP: 'short-tap',
  SIZE_LIMIT: 'size-limit',
  CAPTURE_FAILURE: 'capture-failure',
  CANCELLED: 'cancelled'
}

export function recordingOutcomeOk (recording) {
  return { kind: RecorderOutcomeKind.OK, recording, error: null }
}

export function recordingOutcomeShortTap (durationMs) {
  return {
    kind: RecorderOutcomeKind.SHORT_TAP,
    recording: null,
    error: null,
    durationMs
  }
}

export function recordingOutcomeSizeLimit (recording) {
  return { kind: RecorderOutcomeKind.SIZE_LIMIT, recording, error: null }
}

export function recordingOutcomeCaptureFailure (error) {
  return { kind: RecorderOutcomeKind.CAPTURE_FAILURE, recording: null, error }
}

export function recordingOutcomeCancelled () {
  return { kind: RecorderOutcomeKind.CANCELLED, recording: null, error: null }
}

export class RecorderOutcomeError extends Error {
  constructor (outcome) {
    super(outcome.error?.message ?? 'Recording failed')
    this.name = 'RecorderOutcomeError'
    this.outcome = outcome
  }
}

Gio._promisify(
  Gio.InputStream.prototype,
  'read_bytes_async',
  'read_bytes_finish'
)

const DEFAULT_CHUNK_MS = 100
const BYTES_PER_SAMPLE = 2
// 24 MB of PCM16: the memory/upload safety cap, independent of quality.
const MAX_PCM_BYTES = 24 * 1024 * 1024

// Recording id: the capture start time as a UTC timestamp string. It is
// also the file name — recordings are strictly serial, so start times never
// collide, and a lexical sort of the directory sorts by recency. The
// filename-safe shape is compact ISO 8601 with milliseconds:
// YYYYMMDDTHHMMSSmmm (20260905T062638123).
export function recordingIdForNow () {
  const now = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
    `${pad(now.getUTCMilliseconds(), 3)}`
}

export class AudioRecorder {
  constructor (recordingsDirectory, onLevel, onError, sampleRate = DEFAULT_SAMPLE_RATE) {
    this._recordingsDirectory = recordingsDirectory
    this._onLevel = onLevel
    this._onError = onError
    this._sampleRate = sampleRate || DEFAULT_SAMPLE_RATE
    this._bytesPerMs = this._sampleRate * BYTES_PER_SAMPLE / 1000
    this._minimumBytes = this._bytesPerMs * 1000
    // 100 ms of PCM16 at the chosen rate.
    this._chunkBytes = this._bytesPerMs * DEFAULT_CHUNK_MS
    this._outcome = null
  }

  async start () {
    if (this._process) { throw new Error('Audio capture is already running') }

    const pwRecord = GLib.find_program_in_path('pw-record')
    if (!pwRecord) { throw new Error('pw-record was not found. Install Fedora pipewire-utils.') }

    this._process = Gio.Subprocess.new(
      [
        pwRecord,
        '--raw',
        `--rate=${this._sampleRate}`,
        '--channels=1',
        '--format=s16',
        '-'
      ],
      Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_SILENCE
    )

    const id = recordingIdForNow()
    this._path = GLib.build_filenamev([
      this._recordingsDirectory,
      `${id}.wav`
    ])
    this._id = id
    this._limitReached = false
    this._cancelled = false
    this._output = Gio.File.new_for_path(this._path).replace(
      null,
      false,
      Gio.FileCreateFlags.PRIVATE,
      null
    )
    this._output.write_all(new Uint8Array(44), null)
    this._totalBytes = 0
    this._stream = this._process.get_stdout_pipe()
    this._readPromise = this._readLoop()
    this._readPromise.catch(error => this._onError?.(error))
  }

  async stop () {
    // Idempotent: the first stop decides the outcome; later stops return it
    // unchanged instead of re-reading a torn-down stream.
    if (this._outcome) { return this._outcome }

    const process = this._process
    if (!process) {
      return this._outcome = this._cancelled
        ? recordingOutcomeCancelled()
        : recordingOutcomeCaptureFailure(
          new Error('Audio capture is not running')
        )
    }

    // SIGINT lets pw-record close cleanly after its final raw PCM chunk.
    process.send_signal(2)

    try {
      await this._readPromise
    } catch (error) {
      if (this._cancelled) {
        return this._outcome = recordingOutcomeCancelled()
      }
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
        return this._outcome = recordingOutcomeCaptureFailure(error)
      }
    } finally {
      this._process = null
      this._stream = null
      this._readPromise = null
    }

    if (this._cancelled) {
      this._discardFile()
      return this._outcome = recordingOutcomeCancelled()
    }

    if (this._limitReached) {
      this._finalizeWav()
      return this._outcome = recordingOutcomeSizeLimit(this._takeRecording())
    }

    if (!this._totalBytes) {
      this._discardFile()
      return this._outcome = recordingOutcomeShortTap(0)
    }
    if (this._totalBytes < this._minimumBytes) {
      this._discardFile()
      return this._outcome = recordingOutcomeShortTap(
        Math.round(this._totalBytes / this._bytesPerMs)
      )
    }

    this._finalizeWav()
    return this._outcome = recordingOutcomeOk(this._takeRecording())
  }

  _finalizeWav () {
    this._output.seek(0, GLib.SeekType.SET, null)
    this._output.write_all(wavHeader(this._totalBytes, this._sampleRate), null)
    this._output.close(null)
    this._output = null
  }

  _takeRecording () {
    const recording = {
      id: this._id,
      path: this._path,
      mimeType: 'audio/wav',
      sampleRate: this._sampleRate,
      channels: 1,
      durationMs: Math.round(this._totalBytes / this._bytesPerMs)
    }

    this._id = null
    this._path = null
    this._totalBytes = 0
    return recording
  }

  async _readLoop () {
    while (this._stream) {
      const bytes = await this._stream.read_bytes_async(
        this._chunkBytes,
        GLib.PRIORITY_DEFAULT,
        null
      )

      if (bytes.get_size() === 0) { break }
      if (!this._stream) { break }

      const data = bytes.get_data()
      if (this._totalBytes + data.length > MAX_PCM_BYTES) {
        this._limitReached = true
        this._process?.send_signal(2)
        break
      }

      this._output.write_all(data, null)
      this._totalBytes += data.length
      this._onLevel?.(calculateRms(data))
    }
  }

  cancel () {
    // Marks an orchestrator-driven cancel so a racing stop() reports
    // cancellation instead of a capture failure.
    this._cancelled = true
    try {
      this._process?.send_signal(2)
    } catch {
      // Process may already have exited.
    }
  }

  destroy () {
    try {
      this._process?.send_signal(2)
    } catch {
      // Process may already have exited.
    }

    this._process = null
    this._stream = null
    this._readPromise = null
    this._discardFile()
    this._id = null
    this._totalBytes = 0
    this._limitReached = false
    this._cancelled = false
    this._outcome = null
    this._recordingsDirectory = null
    this._onLevel = null
    this._onError = null
  }

  _discardFile () {
    try {
      this._output?.close(null)
    } catch {
      // The stream may already be closed after a recorder failure.
    }
    this._output = null

    if (!this._path) { return }
    try {
      Gio.File.new_for_path(this._path).delete(null)
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) { console.warn(`[toas] Could not remove partial recording: ${error.message}`) }
    }
    this._path = null
  }
}

function wavHeader (pcmBytes, sampleRate) {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) { header[offset + i] = value.charCodeAt(i) }
  }

  const blockAlign = BYTES_PER_SAMPLE

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcmBytes, true)

  return header
}

function calculateRms (data) {
  if (!data || data.length < 2) { return 0 }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const sampleCount = Math.floor(data.byteLength / 2)
  let sumSquares = 0

  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true) / 32768
    sumSquares += sample * sample
  }

  const rms = Math.sqrt(sumSquares / sampleCount)
  return Math.min(1, rms * 5)
}
