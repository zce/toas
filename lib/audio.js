import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(
    Gio.InputStream.prototype,
    'read_bytes_async',
    'read_bytes_finish'
);

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const CHUNK_BYTES = 3200; // 100ms of PCM16 @ 16 kHz mono.

export class AudioCapture {
    constructor(onChunk, onLevel) {
        this._onChunk = onChunk;
        this._onLevel = onLevel;
    }

    async start() {
        if (this._process)
            throw new Error('Audio capture is already running');

        const pwRecord = GLib.find_program_in_path('pw-record');
        if (!pwRecord)
            throw new Error('pw-record was not found. Install Fedora pipewire-utils.');

        this._process = Gio.Subprocess.new(
            [
                pwRecord,
                '--raw',
                `--rate=${SAMPLE_RATE}`,
                `--channels=${CHANNELS}`,
                '--format=s16',
                '-',
            ],
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_SILENCE
        );

        this._stream = this._process.get_stdout_pipe();
        this._readPromise = this._readLoop();
    }

    async stop() {
        const process = this._process;
        if (!process)
            return;

        // SIGINT lets pw-record close cleanly after its final raw PCM chunk.
        process.send_signal(2);

        try {
            await this._readPromise;
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw error;
        } finally {
            this._process = null;
            this._stream = null;
            this._readPromise = null;
        }
    }

    async _readLoop() {
        while (this._stream) {
            const bytes = await this._stream.read_bytes_async(
                CHUNK_BYTES,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (bytes.get_size() === 0)
                break;

            if (!this._stream)
                break;

            const data = bytes.get_data();
            this._onLevel?.(calculateRms(data));
            this._onChunk?.(data);
        }
    }

    destroy() {
        try {
            this._process?.send_signal(2);
        } catch {
            // Process may already have exited.
        }

        this._process = null;
        this._stream = null;
        this._readPromise = null;
        this._onChunk = null;
        this._onLevel = null;
    }
}

function calculateRms(data) {
    if (!data || data.length < 2)
        return 0;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sampleCount = Math.floor(data.byteLength / 2);
    let sumSquares = 0;

    for (let i = 0; i < sampleCount; i++) {
        const sample = view.getInt16(i * 2, true) / 32768;
        sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    return Math.min(1, rms * 5);
}
