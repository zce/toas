import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { expectEqual, expectTruthy, run, test } from './harness.js'

const read = path => new TextDecoder().decode(GLib.file_get_contents(path)[1])

test('earcons default on, choices stay independent and disabled mode has one switch', () => {
  const xml = read('schemas/org.gnome.shell.extensions.toas.gschema.xml')
  const prefs = read('prefs.js')

  expectTruthy(xml.includes('<key name="sound-enabled" type="b">\n      <default>true</default>'))
  expectTruthy(xml.includes("<key name=\"sound-start-style\" type=\"s\">\n      <default>'crystal'</default>"))
  expectTruthy(xml.includes("<key name=\"sound-end-style\" type=\"s\">\n      <default>'tap'</default>"))
  expectTruthy(prefs.includes("settings.bind('sound-enabled', cueEnabled, 'active'"))
  expectTruthy(prefs.includes("group.add(soundRow('start', 'Start sound'))"))
  expectTruthy(prefs.includes("group.add(soundRow('end', 'Stop sound'))"))
})

test('cue cache has a stable unversioned path and refreshes generated audio', () => {
  const player = read('host/earcons.js')
  const install = read('install.sh')
  const uninstall = read('docs/uninstall.sh')

  expectTruthy(player.includes("GLib.get_user_cache_dir(), 'toas', 'sounds'"))
  expectTruthy(!player.includes('earcons-v'))
  expectTruthy(player.includes("file.replace_contents(synthesizeCue(kind, style)"))
  expectTruthy(!player.includes('file.query_exists(null)'))
  expectTruthy(install.includes('for previous in "$CACHE_DIR"/earcons-v[0-9]*'))
  expectTruthy(uninstall.includes('rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/toas"'))
})

await run()
