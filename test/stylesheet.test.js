// Stylesheet hygiene: every class defined in stylesheet.css must be used by
// Shell-side code, and every class in prefs.css by prefs.js. A class nobody
// references is dead CSS; catching it here keeps the stylesheets honest.
// The reverse direction (a class used but undefined) is caught at runtime by
// missing styling, so it is not asserted.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { test, expectEqual, run } from './harness.js'

const rootDir = GLib.get_current_dir()

function read (path) {
  const [, contents] = GLib.file_get_contents(path)
  return new TextDecoder().decode(contents)
}

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
    const type = info.get_file_type()
    const child = `${dir}/${name}`
    if (type === Gio.FileType.DIRECTORY) {
      modules.push(...listModules(child, `${prefix}${name}/`))
    } else if (name.endsWith('.js')) {
      modules.push(`${prefix}${name}`)
    }
  }
  enumerator.close(null)
  return modules
}

function cssClasses (source) {
  const classes = new Set()
  // Strip comments first so file names like prefs.css are not parsed as
  // class selectors.
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of noComments.matchAll(/\.([a-z][a-z0-9-]+)/g)) {
    classes.add(m[1])
  }
  return classes
}

function usedClasses (source) {
  const used = new Set()
  for (const m of source.matchAll(/(?:style_class\s*[:=]|add_style_class_name|remove_style_class_name|add_css_class)\s*\(?\s*['"`]([^'"`]+)/g)) {
    for (const name of m[1].split(/\s+/)) {
      if (name && !name.startsWith('-')) { used.add(name) }
    }
  }
  return used
}

test('every stylesheet.css class is referenced by Shell-side code', () => {
  const css = read(`${rootDir}/stylesheet.css`)
  const defined = cssClasses(css)

  // Classes the Shell theme itself owns; toas styles only decorate them.
  const shellTheme = new Set(['panel-button', 'icon-button', 'system-status-icon', 'card', 'inline', 'warning'])

  const sources = ['extension.js', 'ui/indicator.js', 'ui/shell-overlay-view.js']
    .map(f => read(`${rootDir}/${f}`))
    .join('\n')

  const used = usedClasses(sources)
  const dead = [...defined].filter(c => !used.has(c) && !shellTheme.has(c))

  expectEqual(dead.sort().join(','), '', `unused classes: ${dead.join(', ')}`)
})

test('every prefs.css class is referenced by prefs.js', () => {
  const css = read(`${rootDir}/prefs.css`)
  const defined = cssClasses(css)

  // libadwaita built-ins the CSS reuses, not toas-owned classes.
  const adwaitaBuiltins = new Set(['card'])

  const sources = read(`${rootDir}/prefs.js`)
  const used = usedClasses(sources)
  const dead = [...defined].filter(c => !used.has(c) && !adwaitaBuiltins.has(c))

  expectEqual(dead.sort().join(','), '', `unused classes: ${dead.join(', ')}`)
})

test('stylesheet and prefs stylesheets stay separate', () => {
  // The two CSS dialects are not interchangeable; shipping the wrong one
  // to a process would silently style nothing.
  const shellCss = read(`${rootDir}/stylesheet.css`)
  const prefsCss = read(`${rootDir}/prefs.css`)

  // St-only syntax in prefs.css would not parse in GTK4.
  expectEqual(shellCss.includes('-st-accent'), true)
  expectEqual(prefsCss.includes('-st-accent'), false)
})

await run()