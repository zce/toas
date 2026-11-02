import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { process as runKernel } from '../kernel/process.js'
import { providers as registry } from '../kernel/providers/registry.js'
import { primaryReady, snapshotContext, snapshotProcessingConfig, snapshotProviderSecrets } from './config.js'
import { SoupHttpTransport } from './transport.js'

Gio._promisify(Gio.File.prototype, 'load_bytes_async', 'load_bytes_finish')

// Slightly above the recorder's 24 MB PCM cap, so the upload limit only
// rejects recordings the recorder would never produce.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Host-side seam to the Kernel: snapshots the current configuration, loads
// the recording, and runs one processing attempt on a shared Soup session.
export class KernelRunner {
  constructor({ settings, providers = registry }) {
    this._settings = settings
    this._providers = providers
    this._transport = new SoupHttpTransport()
    this._clock = { now: () => GLib.get_monotonic_time() / 1000 }
  }

  primaryReady() {
    return primaryReady(this._settings, this._providers)
  }

  async run(recording, signal, onStage = null) {
    const config = snapshotProcessingConfig(this._settings, this._providers)
    const secrets = snapshotProviderSecrets(this._settings, this._providers)
    const context = snapshotContext(this._settings)
    const audio = await this._loadAudio(recording, signal)

    return await runKernel({
      config,
      audio,
      context,
      secrets,
      runtime: {
        transport: this._transport,
        clock: this._clock,
        timeoutMsByRole: { primary: 30000, refine: 15000 }
      },
      signal,
      providers: this._providers,
      onStage
    })
  }

  async _loadAudio(recording, signal) {
    const cancellable = new Gio.Cancellable()
    const onAbort = () => cancellable.cancel()
    signal?.addEventListener?.('abort', onAbort)

    try {
      const file = Gio.File.new_for_path(recording.path)
      const size = file.query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE, Gio.FileQueryInfoFlags.NONE, cancellable).get_size()
      if (size > MAX_AUDIO_BYTES) {
        throw new Error(`Recording exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MB upload limit`)
      }

      const [contents] = await file.load_bytes_async(cancellable)
      if (signal?.aborted) {
        throw new Error('Processing cancelled')
      }
      return {
        kind: 'audio',
        base64: GLib.base64_encode(contents.get_data()),
        mimeType: recording.mimeType,
        durationMs: recording.durationMs
      }
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  destroy() {
    this._transport?.destroy()
    this._transport = null
    this._settings = null
    this._providers = null
  }
}
