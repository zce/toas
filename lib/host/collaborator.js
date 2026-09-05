// Kernel collaborator for the GNOME Host: loads portable audio, snapshots
// Config/secrets/Context once per attempt, and invokes the runtime-agnostic
// Kernel with a real AbortController. Settings changed after an attempt
// starts affect only the next attempt.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { process as runKernel } from '../kernel/process.js'
import { providers as registry } from '../kernel/providers/registry.js'
import { SoupHttpTransport } from './soup-http-transport.js'
import { MonotonicClock } from './clock.js'
import { ConfigService } from './config-service.js'

Gio._promisify(
  Gio.File.prototype,
  'load_bytes_async',
  'load_bytes_finish'
)

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export class KernelCollaborator {
  constructor ({ settings, providers = registry }) {
    this._providers = providers
    this._configService = new ConfigService({ settings, providers })
    this._transport = new SoupHttpTransport({ timeoutMs: 120000 })
    this._clock = new MonotonicClock()
  }

  get providers () {
    return this._providers
  }

  get configService () {
    return this._configService
  }

  async run (recording, signal) {
    // One immutable attempt snapshot: Config, secrets, Context, and audio
    // are all read here and never re-read mid-attempt.
    const config = this._configService.snapshotConfig()
    const secrets = this._configService.snapshotSecrets()
    const context = this._configService.snapshotContext()
    const audio = await this._loadAudio(recording)

    return await runKernel({
      config,
      audio,
      context,
      secrets,
      runtime: {
        transport: this._transport,
        clock: this._clock
      },
      signal,
      providers: this._providers
    })
  }

  async _loadAudio (recording) {
    const file = Gio.File.new_for_path(recording.path)

    const fileInfo = file.query_info(
      Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
      Gio.FileQueryInfoFlags.NONE,
      null
    )

    const size = fileInfo.get_size()
    if (size > MAX_AUDIO_BYTES) {
      throw new Error(`Recording exceeds the ${MAX_AUDIO_BYTES / 1024 / 1024} MB upload limit`)
    }

    const [contents] = await file.load_bytes_async(null)

    return {
      kind: 'audio',
      base64: GLib.base64_encode(contents.get_data()),
      mimeType: recording.mimeType,
      durationMs: recording.durationMs
    }
  }

  destroy () {
    this._transport?.destroy()
    this._configService?.destroy()
    this._transport = null
    this._configService = null
    this._providers = null
  }
}
