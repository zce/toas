// Pure formatting helpers for history UI; imported by headless tests and the
// Shell-side indicator menu.

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

// Final text of a history entry: entries store Result text; the legacy
// output/transcript fallbacks exist only for entries written before the
// Result/Trace history shape.
export function previewText (entry) {
  const text = extractText(entry).replace(/\s+/g, ' ').trim()
  if (!text) { return '(no text)' }
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
}

export function extractText (entry) {
  return entry.text || entry.output || entry.transcript || ''
}
