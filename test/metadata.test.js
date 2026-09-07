// Extension metadata sanity checks.

import GLib from 'gi://GLib'

import { expectEqual, expectTruthy, run, test } from './harness.js'

const [, bytes] = GLib.file_get_contents(GLib.get_current_dir() + '/metadata.json')
const meta = JSON.parse(new TextDecoder().decode(bytes))

const [, changelogBytes] = GLib.file_get_contents(GLib.get_current_dir() + '/CHANGELOG.md')
const changelog = new TextDecoder().decode(changelogBytes)

test('metadata has identity and targets', () => {
  expectEqual(meta.uuid, 'toas@zce.me')
  expectEqual(meta.name, 'toas')
  expectEqual(meta.description.startsWith('Talk Once, Act Smart.'), true)
  // Release versions live in CHANGELOG.md, not metadata.json. The em dash
  // separator is part of the release heading format.
  expectTruthy(/^## Version \d+ — \d{4}-\d{2}-\d{2}$/m.test(changelog), 'changelog declares a release version')
  expectEqual(meta['shell-version'].includes('49'), true)
  expectEqual(meta['shell-version'].includes('50'), true)
  expectEqual(meta['settings-schema'], 'org.gnome.shell.extensions.toas')
})

await run()
