import GLib from 'gi://GLib'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const [, bytes] = GLib.file_get_contents(GLib.get_current_dir() + '/metadata.json')
const meta = JSON.parse(new TextDecoder().decode(bytes))

test('metadata has identity and targets', () => {
  expectEqual(meta.uuid, 'toas@zce.me')
  expectEqual(meta.name, 'toas')
  expectEqual(meta.description.startsWith('Talk Once, Act Smart.'), true)
  expectTruthy(meta.version >= 7, 'version bumped for this cycle')
  expectEqual(meta['shell-version'].includes('49'), true)
  expectEqual(meta['shell-version'].includes('50'), true)
  expectEqual(meta['settings-schema'], 'org.gnome.shell.extensions.toas')
})

await run()
