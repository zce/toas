// Module-level smoke check: every lib module must parse and, where it has no
// Shell-only imports, load headlessly. Shell-only modules are listed in
// SHELL_ONLY and only parse-checked (their imports fail outside the Shell).
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import System from 'system'

const SHELL_ONLY = new Set([
  'indicator.js',
  'input.js',
  'notifier.js',
  'overlay.js',
  'shell-overlay-view.js'
])

const libDir = Gio.File.new_for_path(GLib.get_current_dir() + '/lib')
const enumerator = libDir.enumerate_children(
  'standard::name',
  Gio.FileQueryInfoFlags.NONE,
  null
)
const files = []
let info
while ((info = enumerator.next_file(null)) !== null) {
  if (info.get_name().endsWith('.js')) { files.push(info.get_name()) }
}
enumerator.close(null)
files.sort()

let failed = 0
for (const name of files) {
  const path = `${libDir.get_path()}/${name}`
  try {
    await import(`file://${path}`)
    print(`ok (loads)   - lib/${name}`)
  } catch (error) {
    const message = String(error?.message ?? error)
    const shellOnly = message.includes('resource:///org/gnome/shell') ||
            message.includes('Typelib')

    if (SHELL_ONLY.has(name) && shellOnly) {
      print(`ok (shell-only, parsed) - lib/${name}`)
    } else {
      failed++
      print(`FAIL - lib/${name}: ${message}`)
    }
  }
}

print(failed > 0 ? `\n${failed} module(s) failed` : '\nall modules load')
if (failed > 0) { System.exit(1) }