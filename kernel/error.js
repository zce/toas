export function processingError (category, message, status = null) {
  const error = new Error(message)
  error.category = category
  if (status !== null) { error.status = status }
  return error
}

export function cancelledError () {
  return processingError('cancelled', 'Request was cancelled')
}
