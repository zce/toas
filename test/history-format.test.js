import { formatRelativeTime, formatDuration, previewText } from '../host/history.js'
import { test, expectEqual, run } from './harness.js'

test('relative time buckets', () => {
  const now = Date.now()
  expectEqual(formatRelativeTime(new Date(now - 10_000).toISOString(), now), 'just now')
  expectEqual(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now), '5 min ago')
  expectEqual(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now), '3 h ago')
  expectEqual(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString(), now), '2 d ago')
  expectEqual(formatRelativeTime('not-a-date', now), '')
})

test('duration formatting', () => {
  expectEqual(formatDuration(5000), '5s')
  expectEqual(formatDuration(65_400), '1m 5s')
  expectEqual(formatDuration(null), '0s')
})

test('preview truncates on output first, falls back to transcript', () => {
  expectEqual(previewText({ output: 'final text', transcript: 'raw' }), 'final text')
  expectEqual(previewText({ output: null, transcript: 'raw only' }), 'raw only')
  expectEqual(previewText({}), '(no text)')

  const long = 'x'.repeat(100)
  const preview = previewText({ output: long })
  expectEqual(preview.length, 60)
  expectEqual(preview.endsWith('…'), true)
})

test('whitespace is collapsed for previews', () => {
  expectEqual(previewText({ output: 'line one\nline two\ttab' }), 'line one line two tab')
})

await run()
