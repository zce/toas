import GLib from 'gi://GLib'

import { expectEqual, expectTruthy, run, test } from './harness.js'

const read = path => new TextDecoder().decode(GLib.file_get_contents(path)[1])

test('recording sounds use independent start and end choices with None', () => {
  const xml = read('schemas/org.gnome.shell.extensions.toas.gschema.xml')
  const prefs = read('prefs.js')
  const player = read('host/earcons.js')

  expectTruthy(!xml.includes('<key name="sound-enabled"'))
  expectTruthy(xml.includes("<key name=\"sound-start-style\" type=\"s\">\n      <default>'crystal'</default>"))
  expectTruthy(xml.includes("<key name=\"sound-end-style\" type=\"s\">\n      <default>'tap'</default>"))
  expectTruthy(prefs.includes("const cueOptions = ['none', 'tap', 'crystal', 'pulse', 'halo']"))
  expectTruthy(prefs.includes("group.add(soundRow('start', 'Start sound'))"))
  expectTruthy(prefs.includes("group.add(soundRow('end', 'Stop sound'))"))
  expectTruthy(!prefs.includes("title: 'Recording sounds'"))
  expectTruthy(player.includes("if (requested === 'none')"))
  expectTruthy(player.includes('global.display.get_sound_player()'))
  expectTruthy(player.includes('this._player.play_from_file(file'))
  expectTruthy(!player.includes('Gio.Subprocess'))
})

test('legacy HUD is the default, matrix HUD is opt-in', () => {
  const xml = read('schemas/org.gnome.shell.extensions.toas.gschema.xml')
  const prefs = read('prefs.js')
  const extension = read('extension.js')

  expectTruthy(xml.includes('<key name="experimental-matrix-hud" type="b">\n      <default>false</default>'))
  expectTruthy(prefs.includes("settings.bind('experimental-matrix-hud', matrixHud, 'active'"))
  expectTruthy(extension.includes("const view = this._settings.get_boolean('experimental-matrix-hud')"))
  expectTruthy(extension.includes("? new MatrixOverlayView()\n        : new ShellOverlayView()"))
  expectTruthy(!extension.includes('new MatrixOverlayView(), new ShellOverlayView()'))
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
