import { presentFailure } from '../host/feedback.js'
import { test, expectEqual, run } from './harness.js'

function error (category, message = 'technical provider detail') {
  return { category, message }
}

test('failure presentation maps existing categories to useful guidance', () => {
  expectEqual(presentFailure(error('no-text')), {
    summary: 'No speech detected',
    guidance: 'Try again.'
  })
  expectEqual(presentFailure(error('configuration')), {
    summary: 'Provider settings need attention',
    guidance: 'Check your provider settings.'
  })
  expectEqual(presentFailure(error('network')), {
    summary: 'Connection problem',
    guidance: 'Check your connection and try again.'
  })
  expectEqual(presentFailure(error('timeout')), {
    summary: 'Request timed out',
    guidance: 'Try again.'
  })
  expectEqual(presentFailure(error('service')), {
    summary: 'Provider error',
    guidance: 'The provider could not process this request. Try again.'
  })
})

test('provider-specific categories stay safe and concise', () => {
  expectEqual(presentFailure(error('authentication', 'HTTP 401 secret detail')), {
    summary: 'Provider authentication failed',
    guidance: 'Check your API key in Settings.'
  })
  expectEqual(presentFailure(error('not-found', 'HTTP 404 raw body')), {
    summary: 'Provider setup not found',
    guidance: 'Check the configured model and endpoint.'
  })
  expectEqual(presentFailure(error('rate-limited', 'HTTP 429 raw body')), {
    summary: 'Provider rate limit reached',
    guidance: 'Try again later.'
  })
  expectEqual(presentFailure(error('invalid-response', '{raw provider payload}')), {
    summary: 'Provider error',
    guidance: 'The provider could not process this request. Try again.'
  })
})

test('recording guidance uses the microphone while unknown failures stay generic', () => {
  expectEqual(presentFailure({ stage: 'recording', message: 'pw-record detail' }), {
    summary: 'Recording failed',
    guidance: 'Check that your microphone is available.'
  })
  expectEqual(presentFailure({ stage: 'processing', message: 'unexpected detail' }), {
    summary: 'Voice input failed',
    guidance: 'Try again.'
  })
})

test('cancellation has no failure presentation', () => {
  expectEqual(presentFailure(error('cancelled')), null)
})

await run()
