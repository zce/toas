// Pure formatting helpers for history UI; imported by headless tests and the
// Shell-side HistoryBrowser.

const PREVIEW_MAX = 60

export function formatRelativeTime (isoString, nowMs = Date.now()) {
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) { return '' }

  const deltaSeconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (deltaSeconds < 60) { return 'just now' }
  if (deltaSeconds < 3600) { return `${Math.floor(deltaSeconds / 60)} min ago` }
  if (deltaSeconds < 86400) { return `${Math.floor(deltaSeconds / 3600)} h ago` }
  return `${Math.floor(deltaSeconds / 86400)} d ago`
}

export function formatDuration (ms) {
  const seconds = Math.round((ms ?? 0) / 1000)
  if (seconds < 60) { return `${seconds}s` }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function previewText (entry) {
  const text = ((entry.output || entry.transcript) ?? '').replace(/\s+/g, ' ').trim()
  if (!text) { return '(no text)' }
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
}
