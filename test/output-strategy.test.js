// Output method selection and clipboard restoration policy.

import { selectOutputMethod, shouldRestoreClipboard } from '../host/output.js'
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
      directInputAvailable: true,
      terminal: false
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

test('restore only while the temporary text still owns the clipboard', () => {
  expectEqual(
    shouldRestoreClipboard({
      currentText: 'voice result',
      temporaryText: 'voice result',
      originalText: 'before'
    }),
    true
  )
})

test('do not overwrite a newer clipboard value', () => {
  expectEqual(
    shouldRestoreClipboard({
      currentText: 'user copied this later',
      temporaryText: 'voice result',
      originalText: 'before'
    }),
    false
  )
})

test('do not restore when original and temporary clipboard text match', () => {
  expectEqual(
    shouldRestoreClipboard({
      currentText: 'same',
      temporaryText: 'same',
      originalText: 'same'
    }),
    false
  )
})

await run()
