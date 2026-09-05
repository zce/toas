// Module smoke check for runtime modules.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

const SHELL_ONLY = new Set([
  'input.js',
  'ui/confirm-dialog.js',
  'ui/indicator.js',
  'ui/notifier.js',
  'ui/shell-overlay-view.js'
])

function listModules (directory, prefix = '') {
  const result = []
  const dir = Gio.File.new_for_path(directory)
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
      const relative = `${prefix}${name}`
      if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        result.push(...listModules(path, `${relative}/`))
      } else if (name.endsWith('.js')) {
        result.push({ path, relative })
      }
    }
  } finally {
    children.close(null)
  }
  return result
}

const root = GLib.get_current_dir()
const rootModules = [
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
].map(relative => ({ relative, path: `${root}/${relative}` }))

const modules = [
  ...rootModules,
  ...listModules(`${root}/kernel`, 'kernel/'),
  ...listModules(`${root}/ui`, 'ui/')
]

let failed = 0

for (const { relative, path } of modules) {
  try {
    await import(`file://${path}`)
    print(`ok (loads) - ${relative}`)
  } catch (error) {
    const message = String(error?.message ?? error)
    const environmentOnly =
      message.includes('resource:///org/gnome/shell') ||
      message.includes('Typelib') ||
      message.includes('Requiring Shell')

    if (SHELL_ONLY.has(relative) && environmentOnly) {
      print(`ok (shell-only, parsed) - ${relative}`)
    } else {
      failed++
      print(`FAIL - ${relative}: ${message}`)
    }
  }
}

if (failed > 0) {
  print(`\n${failed} module(s) failed`)
  System.exit(1)
}

print('\nall runtime modules load')
