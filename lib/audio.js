import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

Gio._promisify(
  Gio.InputStream.prototype,
  'read_bytes_async',
  'read_bytes_finish'
)

const SAMPLE_RATE = 16000
const CHANNELS = 1
const CHUNK_BYTES = 3200 // 100ms of PCM16 @ 16 kHz mono.
const BYTES_PER_SAMPLE = 2
const MIN_PCM_BYTES = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE
const MAX_PCM_BYTES = 24 * 1024 * 1024

export class AudioRecorder {
  constructor (recordingsDirectory, onLevel, onError) {
    this._recordingsDirectory = recordingsDirectory
    this._onLevel = onLevel
    this._onError = onError
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
                `--rate=${SAMPLE_RATE}`,
                `--channels=${CHANNELS}`,
                '--format=s16',
                '-'
      ],
      Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_SILENCE
    )

    const id = GLib.uuid_string_random()
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
    if (this._totalBytes < MIN_PCM_BYTES) {
      this._discardFile()
      return this._outcome = recordingOutcomeShortTap(
        Math.round(this._totalBytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE) * 1000)
      )
    }

    this._finalizeWav()
    return this._outcome = recordingOutcomeOk(this._takeRecording())
  }

  _finalizeWav () {
    this._output.seek(0, GLib.SeekType.SET, null)
    this._output.write_all(wavHeader(this._totalBytes), null)
    this._output.close(null)
    this._output = null
  }

  _takeRecording () {
    const recording = {
      id: this._id,
      path: this._path,
      mimeType: 'audio/wav',
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      durationMs: Math.round(
        this._totalBytes /
                (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE) * 1000
      )
    }

    this._id = null
    this._path = null
    this._totalBytes = 0
    return recording
  }

  async _readLoop () {
    while (this._stream) {
      const bytes = await this._stream.read_bytes_async(
        CHUNK_BYTES,
        GLib.PRIORITY_DEFAULT,
        null
      )

      if (bytes.get_size() === 0) { break }

      if (!this._stream) { break }

      const data = bytes.get_data()
      if (this._totalBytes + data.length > MAX_PCM_BYTES) {
        // Keep the bytes already captured and let stop() report a normal
        // size-limit outcome instead of tearing the session down as an error.
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

function wavHeader (pcmBytes) {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) { header[offset + i] = value.charCodeAt(i) }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true)
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true)
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
