import GLib from 'gi://GLib'

import { expectTruthy, run, test } from './harness.js'

const root = GLib.get_current_dir()
const [, bytes] = GLib.file_get_contents(`${root}/prefs.js`)
const prefs = new TextDecoder().decode(bytes)

test('Context group is mounted beside Processing', () => {
  expectTruthy(prefs.includes('const { processingGroup, contextGroup } = buildProcessingGroups(settings, configurationBanner)'))
  expectTruthy(prefs.includes('page.add(processingGroup)'))
  expectTruthy(prefs.includes('page.add(contextGroup)'))
  expectTruthy(prefs.includes('return { processingGroup, contextGroup }'))
})

test('preferences markup-sensitive text stays safe', () => {
  expectTruthy(prefs.includes("title: 'Recording &amp; History'"))
  expectTruthy(prefs.includes("new Adw.Banner({ title: '', revealed: false, use_markup: false })"))
  expectTruthy(prefs.includes("new Adw.ActionRow({ title: 'Connection', subtitle: 'Verify the current settings.', use_markup: false })"))
})

await run()
