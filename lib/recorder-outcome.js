// Structured recorder outcomes. A recording ends for exactly one reason;
// callers classify outcomes instead of parsing error message strings.

export const RecorderOutcomeKind = {
  OK: 'ok',
  SHORT_TAP: 'short-tap',
  CAPTURE_FAILURE: 'capture-failure'
}

export function recordingOutcomeOk (recording) {
  return { kind: RecorderOutcomeKind.OK, recording, error: null }
}

export function recordingOutcomeShortTap (durationMs) {
  return {
    kind: RecorderOutcomeKind.SHORT_TAP,
    recording: null,
    error: null,
    durationMs
  }
}

export function recordingOutcomeCaptureFailure (error) {
  return { kind: RecorderOutcomeKind.CAPTURE_FAILURE, recording: null, error }
}

export class RecorderOutcomeError extends Error {
  constructor (outcome) {
    super(outcome.error?.message ?? 'Recording failed')
    this.name = 'RecorderOutcomeError'
    this.outcome = outcome
  }
}