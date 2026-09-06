// Protocol-neutral HTTP support for Provider processors.
// Provider-specific payloads, response shapes, and business errors stay in
// their Provider modules. This module must not import GNOME/GI libraries.

import { processingError } from '../error.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeJsonBody (value) {
  return encoder.encode(JSON.stringify(value))
}

export function decodeJsonBody (bytes) {
  if (!bytes || bytes.length === 0) {
    throw processingError('invalid-response', 'The service returned an empty body')
  }
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw processingError('invalid-response', 'The service returned invalid JSON')
  }
}

export function serviceErrorFromHttpStatus (status, label, detail = '') {
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

  const safeDetail = String(detail ?? '').slice(0, 200)
  if (safeDetail) { message = `${message}: ${safeDetail}` }
  return processingError(category, message, status)
}
