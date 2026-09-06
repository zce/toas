// Small presentation mapping from existing runtime error semantics to user-facing copy.
// Raw Provider/transport messages stay in logs and persisted diagnostics; normal UI
// consumes only these stable summaries and next actions.

const PRESENTATIONS = {
  'no-text': {
    summary: 'No speech detected',
    guidance: 'Record again and make sure your voice is audible.'
  },
  configuration: {
    summary: 'Provider settings need attention',
    guidance: 'Open Settings and review the selected provider, model, and endpoint.'
  },
  authentication: {
    summary: 'Provider authentication failed',
    guidance: 'Open Settings and update the API key for this provider.'
  },
  'not-found': {
    summary: 'Provider setup not found',
    guidance: 'Check that the selected model and endpoint are available for this provider.'
  },
  network: {
    summary: 'Connection problem',
    guidance: 'Check your internet connection, then try again.'
  },
  timeout: {
    summary: 'Request timed out',
    guidance: 'The provider took too long to respond. Try again in a moment.'
  },
  'rate-limited': {
    summary: 'Provider rate limit reached',
    guidance: 'Give the provider a moment, then try again.'
  },
  service: {
    summary: 'Provider error',
    guidance: 'The provider is having trouble right now. Try again in a moment.'
  },
  'invalid-response': {
    summary: 'Unexpected provider response',
    guidance: 'Try again; if it keeps happening, check the provider setup.'
  },
  recording: {
    summary: 'Recording failed',
    guidance: 'Check your microphone, then record again.'
  }
}

export function presentFailure (error, stage = null) {
  const category = presentationCategory(error, stage)
  if (category === 'cancelled') { return null }

  return PRESENTATIONS[category] ?? {
    summary: 'Voice input failed',
    guidance: 'Try once more; if it keeps failing, check your provider settings and connection.'
  }
}

function presentationCategory (error, stage) {
  if (error?.category) { return error.category }
  if (stage === 'recording' || error?.stage === 'recording') { return 'recording' }
  if (stage === 'configuration' || error?.stage === 'configuration') { return 'configuration' }

  // Older retained entries predate persisted categories and only carry the
  // original stage/message. Match the exact message emitted by that old
  // no-text path rather than inferring semantics from arbitrary provider text.
  if (error?.message === 'No speech was recognized') { return 'no-text' }

  return 'unknown'
}
