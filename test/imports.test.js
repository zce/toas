// Static import audit. Part 1: every relative import in lib/ must point to an
// existing module, and every named import must exist in the target's exports.
// Part 2: every reference to a name exported by another lib module must be
// imported (or locally defined) in the referencing file. Both catch
// missing-import runtime crashes that parse checks cannot see.
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import { test, expectTruthy, run } from './harness.js'

const rootDir = GLib.get_current_dir()
const libDir = rootDir + '/lib'

function listLib () {
  const enumerator = Gio.File.new_for_path(libDir).enumerate_children(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    null
  )
  const names = []
  let info
  while ((info = enumerator.next_file(null)) !== null) {
    if (info.get_name().endsWith('.js')) { names.push(info.get_name()) }
  }
  enumerator.close(null)
  return names.sort()
}

const files = listLib()
const decode = new TextDecoder()
const read = path => decode.decode(GLib.file_get_contents(path)[1])
const sources = new Map(files.map(name => [name, read(`${libDir}/${name}`)]))

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
  for (const match of source.matchAll(/^(?:export )?(?:const|let) (\w+)/gm)) {
    names.add(match[1])
  }
  return names
}

// Every name a file binds through imports, aliased to its local name.
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
  return names
}

test('every relative import resolves to an existing module and export', () => {
  for (const file of files) {
    const source = sources.get(file)
    for (const match of source.matchAll(/import \{([^}]+)\} from '\.\/([^']+)'/g)) {
      const target = match[2]
      expectTruthy(files.includes(target), `${file} imports ${target}: module exists`)

      const exported = exportsOf(sources.get(target))
      for (const raw of match[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0]
        expectTruthy(name && exported.has(name),
          `${file} imports { ${name} } from ${target}: export exists`)
      }
    }
  }
})

test('every referenced lib export is imported or locally defined', () => {
  // All names exported anywhere in lib/ and where they are defined.
  const inventory = []
  for (const file of files) {
    for (const name of exportsOf(sources.get(file))) {
      inventory.push({ name, definedIn: file })
    }
  }

  // extension.js and prefs.js sit at the root; lib modules in lib/.
  const scan = [
    ...files.map(name => ({ name: `lib/${name}`, source: sources.get(name) })),
    { name: 'extension.js', source: read(`${rootDir}/extension.js`) },
    { name: 'prefs.js', source: read(`${rootDir}/prefs.js`) }
  ]

  for (const { name: file, source } of scan) {
    const imported = importsOf(source)
    const locals = localsOf(source)
    // Import lines themselves must not count as usage.
    const body = source.split('\n').filter(line => !/^\s*import\b/.test(line)).join('\n')
    // Comment-only mentions (e.g. "Public read access for HistoryRepository")
    // are not references.
    const code = body.split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n')

    for (const { name, definedIn } of inventory) {
      if (definedIn === file || definedIn === file.replace('lib/', '')) { continue }
      if (!new RegExp(`\\b${name}\\b`).test(code)) { continue }
      expectTruthy(imported.has(name) || locals.has(name),
        `${file} references ${name} (exported by ${definedIn}) but never imports or defines it`)
    }
  }
})

await run()
