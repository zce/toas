// Static import audit: every relative import in lib/ must point to an existing
// module, and every named import must exist in the target's exports. Catches
// missing-import runtime crashes that parse checks cannot see.
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import { test, expectTruthy, run } from './harness.js'

const libDir = GLib.get_current_dir() + '/lib'

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
const sources = new Map(
  files.map(name => [name, decode.decode(GLib.file_get_contents(`${libDir}/${name}`)[1])])
)

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

await run()