// A fresh GJS process keeps cache writes isolated from the user's XDG paths.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

import { EarconPlayer } from '../../host/earcons.js'
import { CUE_STYLES, synthesizeCue } from '../../host/earcon-synthesis.js'
import { expectEqual, expectTruthy } from '../harness.js'

expectEqual(GLib.get_user_cache_dir(), System.programArgs[0], 'the parent must supply an isolated cache directory')
globalThis.global = {
  display: {
    get_sound_player: () => ({
      play_from_file() { throw new Error('Cache initialization must not play audio') }
    })
  }
}

const settings = { get_string: () => 'none' }
const directory = Gio.File.new_for_path(GLib.build_filenamev([
  GLib.get_user_cache_dir(), 'toas', 'sounds'
]))
const files = CUE_STYLES.flatMap(style => ['start', 'end'].map(kind => ({
  file: directory.get_child(`${kind}-${style}.wav`),
  expected: synthesizeCue(kind, style)
})))

const first = new EarconPlayer(settings)
first.destroy()
for (const { file, expected } of files) {
  const [, contents] = file.load_contents(null)
  expectEqual(contents.length, expected.length)
  expectTruthy(contents.every((byte, index) => byte === expected[index]), file.get_basename())
  file.replace_contents(new Uint8Array([0]), null, false, Gio.FileCreateFlags.PRIVATE, null)
}

const second = new EarconPlayer(settings)
second.destroy()
for (const { file, expected } of files) {
  const [, contents] = file.load_contents(null)
  expectEqual(contents.length, expected.length)
  expectTruthy(contents.every((byte, index) => byte === expected[index]), `refresh ${file.get_basename()}`)
}
