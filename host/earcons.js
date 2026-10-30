import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { CUE_STYLES, CUE_GUARD_MS, DEFAULT_START_CUE, DEFAULT_END_CUE, cueDurationMs, synthesizeCue } from './earcon-synthesis.js'

// Plays the approved original cues with Mutter's native sound player.
// A cue is short and finite. No audio process or active GLib source at rest.
export class EarconPlayer {
  constructor(settings) {
    this._settings = settings
    this._sound = global.display.get_sound_player()
    this._files = new Map()
    this._current = null
    const directory = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'toas', 'earcons-v1']))
    try { directory.make_directory_with_parents(null) }
    catch (error) { if (!error.matches?.(Gio.IOErrorEnum,Gio.IOErrorEnum.EXISTS)) throw error }
    for(const style of CUE_STYLES)for(const kind of ['start','end']){
      const file = directory.get_child(`${kind}-${style}.wav`)
      if(!file.query_exists(null))
        file.replace_contents(synthesizeCue(kind,style),null,false,Gio.FileCreateFlags.PRIVATE,null)
      this._files.set(`${kind}-${style}`,file)
    }
  }

  play(kind) {
    if (!this._settings?.get_boolean('sound-enabled')) return 0
    const fallback=kind==='start'?DEFAULT_START_CUE:DEFAULT_END_CUE
    const selected=this._settings.get_string(`sound-${kind}-style`)
    const style=CUE_STYLES.includes(selected)?selected:fallback
    const file=this._files.get(`${kind}-${style}`)
    if(!file)return 0
    this.cancel()
    try {
      this._current=new Gio.Cancellable()
      this._sound.play_from_file(file, `Toas ${kind} recording`, this._current)
      // The guard bounds normal output buffering. An OS or hardware-specific
      // speaker-to-mic acoustic path cannot be guaranteed in software.
      return cueDurationMs(kind,style)+CUE_GUARD_MS
    } catch(error) {
      console.warn(`[toas] Could not play ${kind} cue: ${error.message}`)
      this._current=null
      return 0
    }
  }

  cancel() {
    this._current?.cancel()
    this._current=null
  }

  destroy() {
    this.cancel()
    this._settings=null
    this._sound=null
    this._files.clear()
  }
}
