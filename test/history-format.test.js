// History presentation helpers: relative time, durations, previews,
// and retry projection.

import { formatDuration, formatRelativeTime, previewText, projectLatestAttempt } from '../host/history.js'
import { expectEqual, run, test } from './harness.js'

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

test('preview uses final history text only', () => {
  expectEqual(previewText({ text: 'final text' }), 'final text')
  expectEqual(previewText({}), '(no text)')

  const long = 'x'.repeat(100)
  const preview = previewText({ text: long })
  expectEqual(preview.length, 60)
  expectEqual(preview.endsWith('…'), true)
})

test('whitespace is collapsed for previews', () => {
  expectEqual(previewText({ text: 'line one\nline two\ttab' }), 'line one line two tab')
})

test('failed preview shows stable stage error context instead of raw detail', () => {
  expectEqual(
    previewText({
      status: 'error',
      transcribe: { error: { code: 'no-text', message: 'No speech was recognized' } }
    }),
    'No speech detected'
  )

  const provider = previewText({
    status: 'error',
    transcribe: {
      error: { code: 'service', message: 'Provider HTTP 500: raw response detail' }
    }
  })
  expectEqual(provider, 'Provider error')
  expectEqual(provider.includes('500'), false)
})

test('retry success replaces processing result while preserving root audio metadata', () => {
  const original = {
    id: 'original',
    time: '2026-01-01',
    status: 'error',
    audio: { file: 'original.wav', durationMs: 3000, sampleRate: 16000 },
    transcribe: { error: { code: 'no-text', message: 'No speech was recognized' } }
  }
  const projected = projectLatestAttempt(original, {
    id: 'retry',
    retryOf: 'original',
    time: '2026-01-02',
    status: 'ok',
    text: 'recovered text',
    transcribe: { provider: 'qwen', model: 'asr', text: 'recovered text' }
  })

  expectEqual(projected.status, 'ok')
  expectEqual(projected.text, 'recovered text')
  expectEqual(projected.transcribe.text, 'recovered text')
  expectEqual(projected.audio.file, 'original.wav')
  expectEqual(previewText(projected), 'recovered text')
})

test('retry failure clears stale visible text and uses latest stage error', () => {
  const original = {
    id: 'original',
    status: 'error',
    text: 'stale text from an earlier visible state',
    transcribe: { error: { code: 'no-text', message: 'No speech was recognized' } }
  }
  const projected = projectLatestAttempt(original, {
    status: 'error',
    transcribe: { error: { code: 'network', message: 'DNS detail' } }
  })

  expectEqual(projected.status, 'error')
  expectEqual(Object.hasOwn(projected, 'text'), false)
  expectEqual(previewText(projected), 'Connection problem')
})

test('latest retry can replace a prior refine stage with transcribe-only processing', () => {
  const original = {
    id: 'original',
    status: 'ok',
    text: 'refined',
    transcribe: { text: 'raw' },
    refine: { text: 'refined' }
  }
  const projected = projectLatestAttempt(original, {
    status: 'ok',
    text: 'new raw',
    transcribe: { text: 'new raw' }
  })

  expectEqual(projected.text, 'new raw')
  expectEqual(Object.hasOwn(projected, 'refine'), false)
})

await run()
