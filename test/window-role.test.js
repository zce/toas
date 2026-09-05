import { isTerminalWindow } from '../host/output.js'
import { expectEqual, run, test } from './harness.js'

test('recognizes standalone terminals from Wayland application identifiers', () => {
  expectEqual(isTerminalWindow({
    get_gtk_application_id: () => 'org.gnome.Ptyxis'
  }), true)

  expectEqual(isTerminalWindow({
    get_wm_class: () => 'com.mitchellh.ghostty'
  }), true)

  expectEqual(isTerminalWindow({
    get_sandboxed_app_id: () => 'org.gnome.Console'
  }), true)
})

test('does not infer terminal role from a window title', () => {
  expectEqual(isTerminalWindow({
    get_wm_class: () => 'org.gnome.TextEditor',
    get_title: () => 'terminal-notes.md'
  }), false)
})

test('handles a missing focused window', () => {
  expectEqual(isTerminalWindow(null), false)
})

await run()
