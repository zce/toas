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
  expectTruthy(prefs.includes("group.add(soundRow('start', 'Start sound', 'Play a cue when recording starts; None skips it.'))"))
  expectTruthy(prefs.includes("group.add(soundRow('end', 'Stop sound', 'Play after a valid recording; None skips the cue.'))"))
  expectTruthy(!prefs.includes("title: 'Recording sounds'"))
  expectTruthy(prefs.includes("cueOptions.includes(requested) ? requested : fallback"))
  expectTruthy(player.includes("if (requested === 'none' || !this._soundSettings.get_boolean('event-sounds'))"))
  expectTruthy(player.includes('global.display.get_sound_player()'))
  expectTruthy(player.includes('this._player.play_from_file(file'))
  expectTruthy(!player.includes('Gio.Subprocess'))
})

test('legacy HUD is the default, matrix HUD is opt-in', () => {
  const xml = read('schemas/org.gnome.shell.extensions.toas.gschema.xml')
  const prefs = read('prefs.js')
  const extension = read('extension.js')

  expectTruthy(xml.includes('<key name="experimental-matrix-hud" type="b">\n      <default>false</default>'))
  expectTruthy(prefs.includes("title: 'Experimental UI'"))
  expectTruthy(prefs.includes("settings.bind('experimental-matrix-hud', matrixHud, 'active'"))
  expectTruthy(extension.includes("this._matrixHud = this._settings.get_boolean('experimental-matrix-hud')"))
  expectTruthy(extension.includes("this._settings.connect('changed::experimental-matrix-hud'"))
  expectTruthy(extension.includes('this._overlay.replaceView('))
  expectTruthy(extension.includes("this._voiceState !== 'idle' && this._voiceState !== 'error'"))
})

test('Maple Mono only styles overlay surfaces', () => {
  const css = read('stylesheet.css')
  const prefsCss = read('prefs.css')
  const prefs = read('prefs.js')

  expectTruthy(/\.toas-overlay\s*\{\s*font-family:\s*'Maple Mono'/.test(css))
  expectTruthy(/\.toas-matrix-overlay\s*\{\s*font-family:\s*'Maple Mono'/.test(css))
  expectTruthy(!/\.toas-history-menu-scroll\s*\{\s*font-family:/.test(css))
  expectTruthy(!prefsCss.includes('Maple Mono'))
  expectTruthy(!prefs.includes("add_css_class('toas-preferences')"))
})

test('audio quality has a description', () => {
  const prefs = read('prefs.js')
  expectTruthy(prefs.includes("subtitle: 'Higher rates use more space and shorten recording time.'"))
})

test('recording retention and refine failure choices have explanations', () => {
  const prefs = read('prefs.js')

  expectTruthy(/title: 'On refine failure',\s+subtitle:/.test(prefs))
  expectTruthy(prefs.includes("'Keep this many history entries on this device.'"))
  expectTruthy(prefs.includes("'Keep recordings for retries; 0 saves none.'"))
  expectTruthy(/title: 'Shortcut',\s+subtitle:/.test(prefs))
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
