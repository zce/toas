// Structured recorder outcomes. A recording ends for exactly one reason;
// callers classify outcomes instead of parsing error message strings.

export const RecorderOutcomeKind = {
  OK: 'ok',
  SHORT_TAP: 'short-tap',
  SIZE_LIMIT: 'size-limit',
  CAPTURE_FAILURE: 'capture-failure',
  CANCELLED: 'cancelled'
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

export function recordingOutcomeSizeLimit (recording) {
  return { kind: RecorderOutcomeKind.SIZE_LIMIT, recording, error: null }
}

export function recordingOutcomeCaptureFailure (error) {
  return { kind: RecorderOutcomeKind.CAPTURE_FAILURE, recording: null, error }
}

export function recordingOutcomeCancelled () {
  return { kind: RecorderOutcomeKind.CANCELLED, recording: null, error: null }
}

export class RecorderOutcomeError extends Error {
  constructor (outcome) {
    super(outcome.error?.message ?? 'Recording failed')
    this.name = 'RecorderOutcomeError'
    this.outcome = outcome
  }
}