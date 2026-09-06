export function processingError (category, message, status = null) {
  const error = new Error(message)
  error.category = category
  if (status !== null) { error.status = status }
  return error
}

export function cancelledError () {
  return processingError('cancelled', 'Request was cancelled')
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
