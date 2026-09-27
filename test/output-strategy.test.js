// Output method selection: direct input versus clipboard fallback.

import { selectOutputMethod, TextPaster } from '../host/output.js'
import { expectEqual, run, test } from './harness.js'

test('direct input is preferred for ordinary focused text fields', () => {
  expectEqual(
    selectOutputMethod({
      text: '你好, Fedora',
      autoPaste: true,
      directInputAvailable: true
    }),
    'direct'
  )
})

test('multiline text can use direct input outside terminals', () => {
  expectEqual(
    selectOutputMethod({
      text: 'first\nsecond',
      autoPaste: true,
      directInputAvailable: true
    }),
    'direct'
  )
})

test('multiline terminal text preserves clipboard paste semantics', () => {
  expectEqual(
    selectOutputMethod({
      text: 'first\nsecond',
      autoPaste: true,
      directInputAvailable: true,
      terminal: true
    }),
    'clipboard'
  )
})

test('missing direct input falls back to clipboard paste', () => {
  expectEqual(
    selectOutputMethod({
      text: 'hello',
      autoPaste: true,
      directInputAvailable: false
    }),
    'clipboard'
  )
})

test('clipboard-only mode never commits directly', () => {
  expectEqual(
    selectOutputMethod({
      text: 'hello',
      autoPaste: false,
      directInputAvailable: true
    }),
    'clipboard'
  )
})

// Exercise delivery with a small fake: never construct a real virtual device
// or inject keyboard events during these tests.
function delivery({ autoPaste = false, restoreClipboard = false, matches = false } = {}) {
  let focused = matches
  let clipboardText = 'previous'
  const calls = { writes: [], reads: 0, pastes: 0, commits: 0 }
  const paster = Object.create(TextPaster.prototype)
  paster._settings = { get_boolean: key => key === 'auto-paste' ? autoPaste : restoreClipboard }
  paster._clipboard = {
    set_text: (_type, value) => {
      clipboardText = value
      calls.writes.push(value)
    }
  }
  paster._keyboard = null
  paster._ibusFocused = false
  paster._ibusManager = { _panelService: null }
  paster._targetWindow = { get_wm_class: () => 'gnome-terminal' }
  paster._targetWindowMatches = () => focused
  paster._getClipboardText = async () => {
    calls.reads++
    return clipboardText
  }
  paster._commitDirect = () => {
    calls.commits++
    return true
  }
  paster._pasteShortcut = () => { calls.pastes++ }
  return { paster, calls, setMatching: value => { focused = value } }
}

test('clipboard-only delivery needs neither keyboard nor clipboard read', async () => {
  const { paster, calls } = delivery({ autoPaste: false, restoreClipboard: true })
  expectEqual(await paster.write('copied text'), { mode: 'copied' })
  expectEqual(calls.writes, ['copied text'])
  expectEqual(calls.reads, 0)
  expectEqual(calls.pastes, 0)
  expectEqual(paster._keyboard, null)
})

test('an uncaptured target is never eligible for automatic insertion', async () => {
  const { paster, calls } = delivery({ autoPaste: true, restoreClipboard: true, matches: true })
  paster._targetWindow = null
  paster._targetWindowMatches = TextPaster.prototype._targetWindowMatches
  expectEqual(paster._targetWindowMatches(), false)
  expectEqual(await paster.write('keep me on the clipboard'), { mode: 'copied', reason: 'focus-mismatch' })
  expectEqual(calls.writes, ['keep me on the clipboard'])
  expectEqual(calls.reads, 0)
  expectEqual(calls.commits, 0)
  expectEqual(calls.pastes, 0)
})

test('a different target copies without creating a keyboard or reading clipboard history', async () => {
  const { paster, calls } = delivery({ autoPaste: true, restoreClipboard: true, matches: false })
  expectEqual(await paster.write('safe fallback'), { mode: 'copied', reason: 'focus-mismatch' })
  expectEqual(calls.writes, ['safe fallback'])
  expectEqual(calls.reads, 0)
  expectEqual(calls.pastes, 0)
  expectEqual(paster._keyboard, null)
})

test('automatic clipboard paste reads old content only when restoration is enabled', async () => {
  const { paster, calls } = delivery({ autoPaste: true, restoreClipboard: false, matches: true })
  // Terminal multiline text always takes the paste path, even if IME is focused.
  expectEqual(await paster.write('first\nsecond'), { mode: 'inserted' })
  expectEqual(calls.writes, ['first\nsecond'])
  expectEqual(calls.reads, 1)
  expectEqual(calls.pastes, 1)
})

test('focus loss while fetching old clipboard contents falls back to copy', async () => {
  const { paster, calls, setMatching } = delivery({ autoPaste: true, restoreClipboard: true, matches: true })
  paster._getClipboardText = async () => {
    calls.reads++
    setMatching(false)
    return 'previous'
  }
  expectEqual(await paster.write('safe result\n'), { mode: 'copied', reason: 'focus-mismatch' })
  expectEqual(calls.writes, ['safe result\n'])
  expectEqual(calls.pastes, 0)
})

test('focus loss during clipboard verification never pastes into the next window', async () => {
  const { paster, calls, setMatching } = delivery({ autoPaste: true, restoreClipboard: false, matches: true })
  paster._getClipboardText = async () => {
    calls.reads++
    setMatching(false)
    return 'verified result\n'
  }
  expectEqual(await paster.write('verified result\n'), { mode: 'copied', reason: 'focus-mismatch' })
  expectEqual(calls.writes, ['verified result\n'])
  expectEqual(calls.pastes, 0)
})

await run()
