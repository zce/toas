import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import {
  CUE_STYLES,
  CUE_GUARD_MS,
  DEFAULT_START_CUE,
  DEFAULT_END_CUE,
  cueDurationMs,
  synthesizeCue
} from './earcon-synthesis.js'

export class EarconPlayer {
  constructor(settings) {
    this._settings = settings
    this._player = GLib.find_program_in_path('pw-play')
    if (!this._player) {
      throw new Error('pw-play is missing (pipewire-utils)')
    }

    this._files = new Map()
    this._playing = null

    const directory = Gio.File.new_for_path(GLib.build_filenamev([
      GLib.get_user_cache_dir(), 'toas', 'sounds'
    ]))

    try {
      directory.make_directory_with_parents(null)
    } catch (error) {
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
        throw error
      }
    }

    for (const style of CUE_STYLES) {
      for (const kind of ['start', 'end']) {
        const file = directory.get_child(`${kind}-${style}.wav`)

        // Refresh the tiny generated WAV on extension enable. Keeping a
        // stable directory must not leave outdated audio after an update.
        file.replace_contents(synthesizeCue(kind, style), null, false,
          Gio.FileCreateFlags.PRIVATE, null)

        this._files.set(`${kind}-${style}`, file)
      }
    }
  }

  play(kind) {
    if (!this._settings?.get_boolean('sound-enabled')) {
      return 0
    }

    const fallback = kind === 'start' ? DEFAULT_START_CUE : DEFAULT_END_CUE
    const requested = this._settings.get_string(`sound-${kind}-style`)
    const style = CUE_STYLES.includes(requested) ? requested : fallback
    const file = this._files.get(`${kind}-${style}`)

    this.cancel()

    try {
      const process = Gio.Subprocess.new(
        [this._player, '--latency=60ms', file.get_path()],
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
      )

      const playback = { process, cancelled: false }
      this._playing = playback

      process.wait_async(null, (subprocess, result) => {
        try {
          subprocess.wait_finish(result)

          if (!playback.cancelled && !subprocess.get_successful()) {
            console.warn(`[toas] ${kind} sound exited (status ${subprocess.get_exit_status()})`)
          }
        } catch (error) {
          if (!playback.cancelled) {
            console.warn(`[toas] ${kind} sound failed: ${error.message}`)
          }
        } finally {
          if (this._playing === playback) {
            this._playing = null
          }
        }
      })

      // Audio device buffering + a 60ms PipeWire playback latency.
      // Physical acoustic feedback cannot be fully ruled out by any timer.
      return cueDurationMs(kind, style) + CUE_GUARD_MS
    } catch (error) {
      console.warn(`[toas] Could not play ${kind} sound: ${error.message}`)
      return 0
    }
  }

  cancel() {
    if (!this._playing) {
      return
    }

    this._playing.cancelled = true
    this._playing.process.force_exit()
    this._playing = null
  }

  destroy() {
    this.cancel()
    this._settings = null
    this._files.clear()
  }
}
