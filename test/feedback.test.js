import { presentFailure } from '../host/feedback.js'
import { test, expectEqual, run } from './harness.js'

function error (category, message = 'technical provider detail') {
  return { category, message }
}

test('failure presentation gives a specific next action for common failures', () => {
  expectEqual(presentFailure(error('no-text')), {
    summary: 'No speech detected',
    guidance: 'Record again and make sure your voice is audible.'
  })
  expectEqual(presentFailure(error('configuration')), {
    summary: 'Provider settings need attention',
    guidance: 'Open Settings and review the selected provider, model, and endpoint.'
  })
  expectEqual(presentFailure(error('network')), {
    summary: 'Connection problem',
    guidance: 'Check your internet connection, then try again.'
  })
  expectEqual(presentFailure(error('timeout')), {
    summary: 'Request timed out',
    guidance: 'The provider took too long to respond. Try again in a moment.'
  })
  expectEqual(presentFailure(error('service')), {
    summary: 'Provider error',
    guidance: 'The provider is having trouble right now. Try again in a moment.'
  })
})

test('provider-specific categories stay safe, concise, and actionable', () => {
  expectEqual(presentFailure(error('authentication', 'HTTP 401 secret detail')), {
    summary: 'Provider authentication failed',
    guidance: 'Open Settings and update the API key for this provider.'
  })
  expectEqual(presentFailure(error('not-found', 'HTTP 404 raw body')), {
    summary: 'Provider setup not found',
    guidance: 'Check that the selected model and endpoint are available for this provider.'
  })
  expectEqual(presentFailure(error('rate-limited', 'HTTP 429 raw body')), {
    summary: 'Provider rate limit reached',
    guidance: 'Give the provider a moment, then try again.'
  })
  expectEqual(presentFailure(error('invalid-response', '{raw provider payload}')), {
    summary: 'Unexpected provider response',
    guidance: 'Try again; if it keeps happening, check the provider setup.'
  })
})

test('recording failures point back to recording while unknown failures remain useful', () => {
  expectEqual(presentFailure({ stage: 'recording', message: 'pw-record detail' }), {
    summary: 'Recording failed',
    guidance: 'Check your microphone, then record again.'
  })
  expectEqual(presentFailure({ stage: 'processing', message: 'unexpected detail' }), {
    summary: 'Voice input failed',
    guidance: 'Try once more; if it keeps failing, check your provider settings and connection.'
  })
})

test('legacy no-text history still uses the current recording guidance', () => {
  expectEqual(presentFailure({ message: 'No speech was recognized' }), {
    summary: 'No speech detected',
    guidance: 'Record again and make sure your voice is audible.'
  })
})

test('cancellation has no failure presentation', () => {
  expectEqual(presentFailure(error('cancelled')), null)
})

await run()
