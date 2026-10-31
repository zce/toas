import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { CUE_STYLES, DEFAULT_START_CUE, DEFAULT_END_CUE } from '../host/earcon-synthesis.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const read = path => new TextDecoder().decode(GLib.file_get_contents(path)[1])

test('recording cue settings preserve independent defaults', () => {
  const xml = read('schemas/org.gnome.shell.extensions.toas.gschema.xml')

  for (const [name, value] of [['sound-start-style', 'crystal'], ['sound-end-style', 'tap']]) {
    const key = xml.match(new RegExp(`<key\\b[^>]*\\bname=["']${name}["'][^>]*>[\\s\\S]*?<\\/key>`))?.[0] ?? ''
    expectTruthy(/\btype=["']s["']/.test(key), `${name} must be a string setting`)
    expectEqual(key.match(/<default>\s*(['"])(.*?)\1\s*<\/default>/)?.[2], value)
  }
  expectEqual(DEFAULT_START_CUE, 'crystal')
  expectEqual(DEFAULT_END_CUE, 'tap')
  expectTruthy(!/<key\b[^>]*\bname=["']sound-enabled["']/.test(xml))
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
  const selectors = source => [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /\bfont-family\s*:[^;]*\bMaple Mono\b/.test(body))
    .flatMap(([, names]) => names.split(',').map(name => name.trim()))
    .sort()

  expectEqual(selectors(read('stylesheet.css')), ['.toas-matrix-overlay', '.toas-overlay'])
  expectEqual(selectors(read('prefs.css')), [])
})

test('cue cache has a stable unversioned path and refreshes generated audio', () => {
  const root = Gio.File.new_for_path(GLib.dir_make_tmp('toas-cue-cache-test-XXXXXX'))
  const app = root.get_child('toas')
  const sounds = app.get_child('sounds')
  const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE })
  // GLib caches XDG paths before module evaluation, so isolate them at startup.
  launcher.setenv('XDG_CACHE_HOME', root.get_path(), true)
  launcher.setenv('GSETTINGS_BACKEND', 'memory', true)
  try {
    const child = launcher.spawnv(['gjs', '-m', 'test/fixtures/earcon-cache.js', root.get_path()])
    child.wait_check(null)
    expectTruthy(read('install.sh').includes('for previous in "$CACHE_DIR"/earcons-v[0-9]*'))
    expectTruthy(read('docs/uninstall.sh').includes('rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/toas"'))
  } finally {
    launcher.close()
    for (const style of CUE_STYLES) {
      for (const kind of ['start', 'end']) {
        const file = sounds.get_child(`${kind}-${style}.wav`)
        if (file.query_exists(null)) file.delete(null)
      }
    }
    for (const directory of [sounds, app, root]) {
      if (directory.query_exists(null)) directory.delete(null)
    }
  }
})

await run()
