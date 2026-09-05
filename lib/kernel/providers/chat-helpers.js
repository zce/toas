// Shared helpers for Chat-Completions-style protocol families. Wire shapes
// stay inside Provider modules; nothing here leaks to the Kernel domain.
// This module must not import GNOME/GI libraries.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeBody (value) {
  return encoder.encode(JSON.stringify(value))
}

export function decodeBody (bytes) {
  if (!bytes || bytes.length === 0) {
    throw protocolError('invalid-response', 'The service returned an empty body')
  }
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw protocolError('invalid-response', 'The service returned invalid JSON')
  }
}

// Text extraction shared by every Chat Completions variant: string content
// or an array of {text} parts.
export function extractContent (data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') { return content }
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('')
  }
  return ''
}

export function normalizeFinishReason (reason) {
  if (!reason) { return null }
  if (reason === 'stop') { return 'stop' }
  if (reason === 'length') { return 'length' }
  if (reason === 'content_filter') { return 'filtered' }
  return 'other'
}

// Best-effort normalization: provider-specific payloads are discarded and
// only nullable token counts cross the Processor boundary.
export function normalizeUsage (usage, { inputKey = 'prompt_tokens', outputKey = 'completion_tokens' } = {}) {
  if (!usage) { return null }
  return {
    inputTokens: usage[inputKey] ?? null,
    outputTokens: usage[outputKey] ?? null,
    totalTokens: usage.total_tokens ?? null
  }
}

// Maps an HTTP status response into the fixed safe categories. The body is
// only mined for a short safe message; it is never surfaced raw.
export function serviceErrorFromStatus (status, bodyBytes, label) {
  let detail = ''
  try {
    const parsed = JSON.parse(decoder.decode(bodyBytes))
    detail = parsed?.error?.message ?? ''
  } catch {
    // Body stays private; the category and label are enough for the user.
  }
  if (detail.length > 200) { detail = detail.slice(0, 200) }

  let category = 'service'
  let message = `${label} service error (HTTP ${status})`

  if (status === 401 || status === 403) {
    category = 'authentication'
    message = `${label} rejected the API key (HTTP ${status})`
  } else if (status === 404) {
    category = 'not-found'
    message = `${label} endpoint or model not found (HTTP 404)`
  } else if (status === 429) {
    category = 'rate-limited'
    message = `${label} rate limit exceeded (HTTP 429)`
  } else if (status >= 500) {
    category = 'service'
    message = `${label} service unavailable (HTTP ${status})`
  }

  if (detail) { message = `${message}: ${detail}` }
  return protocolError(category, message, status)
}

export function protocolError (category, message, status = null) {
  const err = new Error(message)
  err.category = category
  if (status !== null) { err.status = status }
  return err
}

export function cancelledError () {
  return protocolError('cancelled', 'Request was cancelled')
}
