// Static import audit for runtime modules.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { test, expectTruthy, run } from './harness.js'

const root = GLib.get_current_dir()

function listJs (directory) {
  const result = []
  const dir = Gio.File.new_for_path(`${root}/${directory}`)
  const children = dir.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null
  )
  try {
    let info
    while ((info = children.next_file(null))) {
      const name = info.get_name()
      const path = `${directory}/${name}`
      if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        result.push(...listJs(path))
      } else if (name.endsWith('.js')) {
        result.push(path)
      }
    }
  } finally {
    children.close(null)
  }
  return result
}

const rootModules = [
  'extension.js',
  'prefs.js',
  'orchestrator.js',
  'audio.js',
  'audio-quality.js',
  'attempt-signal.js',
  'config-service.js',
  'connection-check.js',
  'history.js',
  'history-format.js',
  'history-repository.js',
  'input.js',
  'kernel-runner.js',
  'onboarding.js',
  'output-strategy.js',
  'processing-config.js',
  'recorder-outcome.js',
  'soup-http-transport.js',
  'window-role.js'
]

const files = [...rootModules, ...listJs('kernel'), ...listJs('ui')]
const decoder = new TextDecoder()

test('runtime tree does not contain a lib directory', () => {
  expectTruthy(!GLib.file_test(`${root}/lib`, GLib.FileTest.IS_DIR), 'lib/ must not exist')
})

test('every relative JavaScript import resolves', () => {
  for (const file of files) {
    const source = decoder.decode(
      Gio.File.new_for_path(`${root}/${file}`).load_contents(null)[1]
    )

    for (const match of source.matchAll(/from\s+['"](\.\.?\/[^'"]+\.js)['"]/g)) {
      const target = GLib.canonicalize_filename(
        match[1],
        GLib.path_get_dirname(`${root}/${file}`)
      )
      expectTruthy(
        GLib.file_test(target, GLib.FileTest.EXISTS),
        `${file} imports missing module ${match[1]}`
      )
    }
  }
})

await run()
