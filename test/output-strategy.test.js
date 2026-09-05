import { selectOutputMethod } from '../lib/output.js'
import { expectEqual, run, test } from './harness.js'

test('direct input is preferred for single-line text with text-input focus', () => {
  expectEqual(selectOutputMethod({
    text: '你好, Fedora',
    autoPaste: true,
    directInputAvailable: true
  }), 'direct')
})

test('multiline text falls back to clipboard paste', () => {
  expectEqual(selectOutputMethod({
    text: 'first\nsecond',
    autoPaste: true,
    directInputAvailable: true
  }), 'clipboard')
})

test('missing text-input focus falls back to clipboard paste', () => {
  expectEqual(selectOutputMethod({
    text: 'hello',
    autoPaste: true,
    directInputAvailable: false
  }), 'clipboard')
})

test('clipboard-only mode never commits directly', () => {
  expectEqual(selectOutputMethod({
    text: 'hello',
    autoPaste: false,
    directInputAvailable: true
  }), 'clipboard')
})

await run()
