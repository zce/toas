import { formatRelativeTime, formatDuration, previewText, projectLatestAttempt } from '../host/history.js'
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

test('failed preview shows stable failure context instead of raw detail', () => {
  expectEqual(previewText({
    status: 'error',
    error: { category: 'no-text', stage: 'processing', message: 'No speech was recognized' }
  }), 'No speech detected')

  const provider = previewText({
    status: 'error',
    error: {
      category: 'service',
      stage: 'processing',
      message: 'Provider HTTP 500: raw response detail'
    }
  })
  expectEqual(provider, 'Provider error')
  expectEqual(provider.includes('500'), false)
})

test('retry success replaces visible failure state and clears the old error', () => {
  const original = {
    id: 'original',
    status: 'error',
    text: null,
    error: { category: 'no-text', stage: 'processing', message: 'No speech was recognized' }
  }
  const projected = projectLatestAttempt(original, [{
    status: 'ok',
    text: 'recovered text',
    attemptNumber: 1
  }])

  expectEqual(projected.status, 'ok')
  expectEqual(projected.text, 'recovered text')
  expectEqual(projected.error, null)
  expectEqual(projected.attemptNumber, 1)
  expectEqual(previewText(projected), 'recovered text')
})

test('retry failure uses the latest attempt error instead of the original error', () => {
  const original = {
    id: 'original',
    status: 'error',
    text: null,
    error: { category: 'no-text', stage: 'processing', message: 'No speech was recognized' }
  }
  const latestError = {
    category: 'network',
    stage: 'processing',
    message: 'DNS detail that should not be shown'
  }
  const projected = projectLatestAttempt(original, [
    {
      status: 'error',
      text: null,
      error: { category: 'service', stage: 'processing', message: 'older retry detail' },
      attemptNumber: 1
    },
    {
      status: 'error',
      text: null,
      error: latestError,
      attemptNumber: 2
    }
  ])

  expectEqual(projected.status, 'error')
  expectEqual(projected.error, latestError)
  expectEqual(projected.attemptNumber, 2)
  expectEqual(previewText(projected), 'Connection problem')
})

await run()
