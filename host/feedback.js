// Small presentation mapping from existing runtime error semantics to user-facing copy.
// Raw Provider/transport messages stay in logs and persisted diagnostics; normal UI
// consumes only these stable summaries and next actions.

const PRESENTATIONS = {
  'no-text': {
    summary: 'No speech detected',
    guidance: 'Try again.'
  },
  configuration: {
    summary: 'Provider settings need attention',
    guidance: 'Check your provider settings.'
  },
  authentication: {
    summary: 'Provider authentication failed',
    guidance: 'Check your API key in Settings.'
  },
  'not-found': {
    summary: 'Provider setup not found',
    guidance: 'Check the configured model and endpoint.'
  },
  network: {
    summary: 'Connection problem',
    guidance: 'Check your connection and try again.'
  },
  timeout: {
    summary: 'Request timed out',
    guidance: 'Try again.'
  },
  'rate-limited': {
    summary: 'Provider rate limit reached',
    guidance: 'Try again later.'
  },
  service: {
    summary: 'Provider error',
    guidance: 'The provider could not process this request. Try again.'
  },
  'invalid-response': {
    summary: 'Provider error',
    guidance: 'The provider could not process this request. Try again.'
  },
  recording: {
    summary: 'Recording failed',
    guidance: 'Check that your microphone is available.'
  }
}

export function presentFailure (error, stage = null) {
  const category = presentationCategory(error, stage)
  if (category === 'cancelled') { return null }

  return PRESENTATIONS[category] ?? {
    summary: 'Voice input failed',
    guidance: 'Try again.'
  }
}

function presentationCategory (error, stage) {
  if (error?.category) { return error.category }
  if (stage === 'recording' || error?.stage === 'recording') { return 'recording' }
  if (stage === 'configuration' || error?.stage === 'configuration') { return 'configuration' }

  // Compatibility for retained entries written before category was persisted.
  if (error?.message === 'No speech was recognized') { return 'no-text' }

  return 'unknown'
}
