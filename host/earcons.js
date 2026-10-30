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
    this._player = global.display.get_sound_player()
    if (!this._player) {
      throw new Error('GNOME Shell sound player is unavailable')
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
        file.replace_contents(synthesizeCue(kind, style), null, false,
          Gio.FileCreateFlags.PRIVATE, null)
        this._files.set(`${kind}-${style}`, file)
      }
    }
  }

  play(kind) {
    const requested = this._settings.get_string(`sound-${kind}-style`)
    if (requested === 'none') {
      return 0
    }

    const fallback = kind === 'start' ? DEFAULT_START_CUE : DEFAULT_END_CUE
    const style = CUE_STYLES.includes(requested) ? requested : fallback
    const file = this._files.get(`${kind}-${style}`)

    this.cancel()

    try {
      const cancellable = new Gio.Cancellable()
      this._player.play_from_file(file, `Toas recording ${kind}`, cancellable)
      this._playing = cancellable
      return cueDurationMs(kind, style) + CUE_GUARD_MS
    } catch (error) {
      console.warn(`[toas] Could not play ${kind} sound: ${error.message}`)
      return 0
    }
  }

  cancel() {
    this._playing?.cancel()
    this._playing = null
  }

  destroy() {
    this.cancel()
    this._settings = null
    this._files.clear()
  }
}
