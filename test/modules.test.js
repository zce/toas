// Module-level smoke check: every lib module must parse and, where it has no
// GNOME-only imports, load headlessly. GNOME-only modules are listed in
// GNOME_ONLY (they need a Shell session or prefs process); runtime-agnostic
// modules (kernel/, plus everything else) must always load.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

// Modules that import Shell resources or Shell-only GI libraries.
const SHELL_ONLY = new Set([
  'ui/confirm-dialog.js',
  'ui/indicator.js',
  'infrastructure/input.js',
  'ui/notifier.js',
  'ui/shell-overlay-view.js',
])

function listModules (dir, prefix = '') {
  const modules = []
  const enumerator = Gio.File.new_for_path(dir).enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null
  )
  let info
  while ((info = enumerator.next_file(null)) !== null) {
    const name = info.get_name()
    const path = `${dir}/${name}`
    const relative = `${prefix}${name}`
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      modules.push(...listModules(path, `${relative}/`))
    } else if (name.endsWith('.js')) {
      modules.push({ relative, path })
    }
  }
  enumerator.close(null)
  return modules
}

const modules = listModules(GLib.get_current_dir() + '/lib')
modules.sort((a, b) => a.relative.localeCompare(b.relative))

let failed = 0
for (const { relative, path } of modules) {
  try {
    await import(`file://${path}`)
    print(`ok (loads)   - lib/${relative}`)
  } catch (error) {
    const message = String(error?.message ?? error)
    const shellOnly = message.includes('resource:///org/gnome/shell') ||
            message.includes('Typelib') ||
            message.includes('Requiring Shell')

    if (SHELL_ONLY.has(relative) && shellOnly) {
      print(`ok (shell-only, parsed) - lib/${relative}`)
    } else {
      failed++
      print(`FAIL - lib/${relative}: ${message}`)
    }
  }
}

print(failed > 0 ? `\n${failed} module(s) failed` : '\nall modules load')
if (failed > 0) { System.exit(1) }
