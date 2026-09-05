// Static import audit. Part 1: every relative import in lib/ must point to an
// existing module, and every named import must exist in the target's exports.
// Part 2: every reference to a name exported by another lib module must be
// imported (or locally defined) in the referencing file. Both catch
// missing-import runtime crashes that parse checks cannot see.
//
// The audit walks lib/ recursively (kernel/, host/, ui/, infrastructure/,
// domain/) so layered modules are covered without a flat-directory whitelist.
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import { test, expectTruthy, run } from './harness.js'

const rootDir = GLib.get_current_dir()
const libDir = rootDir + '/lib'

function listModules (dir) {
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
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
      modules.push(...listModules(path))
    } else if (name.endsWith('.js')) {
      modules.push({ name, path })
    }
  }
  enumerator.close(null)
  return modules
}

const entries = listModules(libDir)
const decode = new TextDecoder()
const read = path => decode.decode(Gio.File.new_for_path(path).load_contents(null)[1])

// module name -> source, keyed by relative path from lib/ (mirrors import
// specifiers like './infrastructure/audio.js').
const sources = new Map()
for (const { name, path } of entries) {
  sources.set(path.replace(libDir + '/', ''), read(path))
}

function exportsOf (source) {
  const names = new Set()
  for (const match of source.matchAll(/export (?:async )?(?:function|class|const|let) (\w+)/g)) {
    names.add(match[1])
  }
  for (const match of source.matchAll(/export \{([^}]+)\}/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]
      if (name) { names.add(name) }
    }
  }
  return names
}

// Every name defined at module scope, exported or not.
function localsOf (source) {
  const names = new Set()
  for (const match of source.matchAll(/^(?:export )?(?:async )?(?:function|class) (\w+)/gm)) {
    names.add(match[1])
  }
  for (const match of source.matchAll(/^(?:export )?const (\w+) =/gm)) {
    names.add(match[1])
  }
  // Indented const/let declarations (method bodies).
  for (const match of source.matchAll(/^\s+(?:const|let) (\w+) =/gm)) {
    names.add(match[1])
  }
  // catch (error) bindings are block-scoped locals.
  for (const match of source.matchAll(/catch\s*\(\s*(\w+)/g)) {
    names.add(match[1])
  }
  // Constructor/method parameter destructuring with shorthand ({ providers })
  // binds a local name exactly like an import would.
  for (const match of source.matchAll(/\(\s*\{([^}]*)\}\s*\)/g)) {
    for (const raw of match[1].split(',')) {
      const parts = raw.trim().split(/\s*[:=]\s*/)
      const name = (parts[1] ?? parts[0])?.trim().split(/\s+as\s+/)[0]
      if (name && /^\w+$/.test(name)) { names.add(name) }
    }
  }
  return names
}

function importsOf (source) {
  const names = new Set()
  for (const match of source.matchAll(/import \{([^}]+)\} from/g)) {
    for (const raw of match[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/)
      const name = parts[1] ?? parts[0]
      if (name) { names.add(name) }
    }
  }
  for (const match of source.matchAll(/import (\w+) from/g)) { names.add(match[1]) }
  for (const match of source.matchAll(/import \* as (\w+) from/g)) { names.add(match[1]) }
  // Dynamic imports with member or destructured access:
  //   (await import('...')).name
  //   const { a, b: c } = await import('...')
  //   const m = await import('...'); m.a
  for (const match of source.matchAll(/import\('([^']+)'[\s\S]{0,120}?\)\)\.(\w+)/g)) {
    names.add(match[2])
  }
  for (const match of source.matchAll(/=\s*await\s+import\('([^']+)'\)/g)) {
    // Find destructuring or member usage within the following ~200 chars.
    const after = source.slice(match.index ?? 0, (match.index ?? 0) + 240)
    for (const inner of after.matchAll(/\{([^}]+)\}/g)) {
      for (const raw of inner[1].split(',')) {
        const parts = raw.trim().split(/\s+as\s+|\s*:\s*/)
        const name = parts[1] ?? parts[0]
        if (name && /^\w+$/.test(name)) { names.add(name) }
      }
    }
    for (const inner of after.matchAll(/(\w+)\.(\w+)/g)) {
      if (match[0].includes(inner[1])) { names.add(inner[2]) }
    }
  }
  return names
}

test('every relative import resolves to an existing module and export', () => {
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/import(?:\s*\{([^}]+)\})?\s*(?:\w+)?\s*(?:,\s*\{([^}]+)\})?\s*from\s+'(\.\.?\/[^']+)'/g)) {
      const specifiers = [match[1], match[2]].filter(Boolean).join(',')
      const target = resolveFrom(file, match[3])

      expectTruthy(
        sources.has(target),
        `${file} imports '${match[3]}': module exists (resolved: ${target})`
      )

      if (!specifiers) { continue }
      const exported = exportsOf(sources.get(target))
      for (const raw of specifiers.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0]
        expectTruthy(name && exported.has(name),
          `${file} imports { ${name} } from ${target}: export exists`)
      }
    }
  }
})

test('every referenced lib export is imported or locally defined', () => {
  const inventory = []
  for (const [file, source] of sources) {
    for (const name of exportsOf(source)) {
      inventory.push({ name, definedIn: file })
    }
  }

  const scan = [
    ...[...sources].map(([name, source]) => ({ name: `lib/${name}`, source })),
    { name: 'extension.js', source: read(`${rootDir}/extension.js`) },
    { name: 'prefs.js', source: read(`${rootDir}/prefs.js`) }
  ]

  for (const { name: file, source } of scan) {
    const imported = importsOf(source)
    const locals = localsOf(source)
    const body = source.split('\n').filter(line => !/^\s*import\b/.test(line)).join('\n')
    const code = body.split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .filter(line => !line.trim().startsWith('*'))
      .join('\n')

    for (const { name, definedIn } of inventory) {
      if (definedIn === file || definedIn === file.replace('lib/', '')) { continue }
      // Strip string literals first so a name appearing inside quotes (for
      // example the setting key "processing-config") is not treated as a
      // reference to an exported symbol.
    const noStrings = code.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
      // JSDoc type references ({@link X}, @typedef, @property {?X}) name
      // types, not runtime symbols.
      .replace(/\{@link\s+\w+(?:\([^)]*\))?\}/g, '()')
      .replace(/@property\s+\{[^}]*\}/g, 'x')
      // Property access (entry.error) and object literal keys are not free
      // references to an exported symbol.
      .replace(/\.\w+/g, '')
      .replace(/[{,]\s*\w+:/g, ',')
      // Method names are class-local.
      .replace(/^\s*(?:async\s+)?(\w+)\s*\(/gm, '(')
      if (!new RegExp(`\\b${name}\\b`).test(noStrings)) { continue }
      expectTruthy(imported.has(name) || locals.has(name),
        `${file} references ${name} (exported by ${definedIn}) but never imports or defines it`)
    }
  }
})

// Resolves a relative import specifier against the importing file's location
// inside lib/.
function resolveFrom (file, specifier) {
  const baseParts = file.split('/')
  baseParts.pop()
  const specParts = specifier.split('/')

  while (specParts[0] === '.' || specParts[0] === '..') {
    if (specParts[0] === '..') { baseParts.pop() }
    specParts.shift()
  }
  return [...baseParts, ...specParts].join('/')
}

await run()
