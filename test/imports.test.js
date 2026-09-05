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

const rootModules = ['extension.js', 'prefs.js']
const files = [
  ...rootModules,
  ...listJs('lib'),
  ...listJs('kernel'),
  ...listJs('ui')
]
const decoder = new TextDecoder()

const removedPaths = [
  'audio.js',
  'audio-quality.js',
  'recorder-outcome.js',
  'history.js',
  'history-repository.js',
  'history-format.js',
  'input.js',
  'output-strategy.js',
  'window-role.js',
  'config-service.js',
  'processing-config.js',
  'connection-check.js',
  'soup-http-transport.js',
  'attempt-signal.js',
  'orchestrator.js',
  'onboarding.js',
  'kernel-runner.js',
  'ui/overlay-presenter.js',
  'ui/shell-overlay-view.js',
  'ui/confirm-dialog.js'
]

test('business modules are grouped out of the root', () => {
  for (const path of removedPaths) {
    expectTruthy(
      !GLib.file_test(`${root}/${path}`, GLib.FileTest.EXISTS),
      `${path} must not remain after consolidation`
    )
  }
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

test('runtime-agnostic kernel does not import Host or UI modules', () => {
  const kernelFiles = ['kernel/process.js', ...listJs('kernel/providers')]

  for (const file of kernelFiles) {
    const source = decoder.decode(
      Gio.File.new_for_path(`${root}/${file}`).load_contents(null)[1]
    )
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      expectTruthy(
        !match[1].includes('/lib/') && !match[1].includes('/ui/'),
        `${file} must stay runtime-agnostic: ${match[1]}`
      )
    }
  }
})

await run()
