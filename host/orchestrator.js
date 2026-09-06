import GLib from 'gi://GLib'

import {
  AudioRecorder,
  DEFAULT_SAMPLE_RATE,
  RecorderOutcomeKind,
  resolveMinimumRecordingDuration,
  resolveSampleRate
} from './audio.js'
import { presentFailure } from './feedback.js'
import { AttemptSignal } from './transport.js'

export class ToasOrchestrator {
  constructor ({
    settings,
    history,
    kernel,
    output,
    overlay,
    notifier,
    recorderFactory = null,
    onStateChanged = null
  }) {
    this._settings = settings
    this._history = history
    this._kernel = kernel
    this._output = output
    this._overlay = overlay
    this._notifier = notifier
    this._onStateChanged = onStateChanged

    const missing = [
      ['history', history],
      ['kernel', kernel],
      ['output', output],
      ['overlay', overlay],
      ['notifier', notifier]
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length > 0) {
      throw new Error(`ToasOrchestrator requires collaborators: ${missing.join(', ')}`)
    }

    this._recorderFactory = recorderFactory ?? (options => new AudioRecorder(options))
    this._state = 'idle'
    this._run = null
    this._abortSignal = null
  }

  toggle () {
    if (this._state === 'idle') { this.begin() } else if (this._state === 'recording') { this.end() }
  }

  begin () {
    if (this._state !== 'idle') { return }

    const run = {
      time: new Date().toISOString(),
      private: Boolean(this._settings?.get_boolean?.('private-mode')),
      recorder: null,
      recording: null,
      ownsRecording: false,
      result: null
    }

    this._overlay.setMonitor(this._output.getFocusedMonitorIndex())
    this._overlay.setPrivate(run.private)
    run.recorder = this._recorderFactory({
      recordingsDirectory: this._history.recordingsDirectory,
      onLevel: level => {
        if (this._run === run && this._state === 'recording') { this._overlay.setLevel(level) }
      },
      onError: error => this._failLive(run, 'recording', error),
      sampleRate: resolveSampleRate(this._settings ?? {}),
      minimumDurationMs: resolveMinimumRecordingDuration(this._settings ?? {})
    })

    this._run = run
    this._overlay.resetLevels()
    this._transition('recording')
    run.recorder.start().catch(error => this._failLive(run, 'recording', error))
  }

  async end () {
    if (this._state !== 'recording') { return }

    const run = this._run
    this._state = 'transcribing'

    let outcome
    try {
      outcome = await run.recorder.stop()
    } catch (error) {
      this._failLive(run, 'recording', error)
      return
    }
    if (this._run !== run) { return }

    if (outcome.kind === RecorderOutcomeKind.SHORT_TAP ||
        outcome.kind === RecorderOutcomeKind.CANCELLED) {
      this._finishRun(run)
      this._transition('idle')
      return
    }

    if (outcome.kind === RecorderOutcomeKind.CAPTURE_FAILURE) {
      this._failLive(run, 'recording', outcome.error ?? new Error('Recording failed'))
      return
    }

    run.recording = outcome.recording
    run.ownsRecording = true
    this._transition('transcribing')

    if (outcome.kind === RecorderOutcomeKind.SIZE_LIMIT) {
      this._notifier.notify(
        'Recording limit reached',
        'The recording hit its cap, so it was cut off and is being processed.'
      )
    }

    // The window focused when recording stops owns this delivery. Capture it
    // before config/audio loading or provider I/O can yield to another window.
    this._output.captureFocusedWindow()
    await this._processLive(run)
  }

  async _processLive (run) {
    let result
    try {
      result = await this._process(run.recording, run)
    } catch (error) {
      if (this._run !== run) { return }
      const stage = error.category === 'configuration' ? 'configuration' : 'processing'
      this._failLive(run, stage, error)
      return
    }
    if (this._run !== run) { return }

    run.result = result
    this._persistLive(run, 'ok')

    const insert = Boolean(this._settings?.get_boolean?.('auto-paste'))
    this._transition(insert ? 'outputting' : 'copying')

    let delivery
    try {
      delivery = await this._output.write(result.text)
    } catch (error) {
      if (this._run === run) { this._failDelivery(run, error) }
      return
    }
    if (this._run !== run) { return }

    this._finishRun(run)

    if (delivery?.reason === 'focus-mismatch') {
      this._notifier.notify(
        'Copied to clipboard',
        'The target window changed, so your text was copied to the clipboard.'
      )
    }

    if (result.warning?.type === 'refine-failed') {
      this._notifier.notify(
        delivery?.mode === 'copied'
          ? 'Copied the transcription'
          : 'Inserted the transcription',
        'Refine failed, so the original transcription was used.'
      )
    }

    this._transition('idle')
  }

  // Retry borrows retained audio, processes it with the current config, and
  // appends another attempt. It never records, owns/deletes source audio, or
  // delivers text to another app.
  async retry (originalEntry) {
    if (this._state !== 'idle') { return null }

    const audio = this._history.resolveAudio(originalEntry)
    if (!audio.available || !audio.path) { return null }

    const run = {
      time: new Date().toISOString(),
      recording: {
        id: originalEntry.id,
        path: audio.path,
        mimeType: 'audio/wav',
        sampleRate: originalEntry.audio?.sampleRate ?? DEFAULT_SAMPLE_RATE,
        channels: 1,
        durationMs: originalEntry.audio?.durationMs ?? 0
      },
      ownsRecording: false,
      result: null
    }

    this._run = run
    this._overlay.setMonitor(null)
    this._overlay.setPrivate(false)
    this._transition('transcribing')

    try {
      run.result = await this._process(run.recording, run)
      if (this._run !== run) { return null }

      const attempt = this._appendRetryAttempt(originalEntry, run)
      this._finishRun(run)
      this._transition('idle')
      return attempt
    } catch (error) {
      if (this._run !== run) { return null }
      return this._failRetry(run, originalEntry, error)
    }
  }

  async _process (recording, run) {
    const signal = new AttemptSignal()
    this._abortSignal = signal
    try {
      return await this._kernel.run(recording, signal, stage => {
        if (stage !== 'refine' || signal.aborted || this._run !== run) { return }
        this._transition('refining')
      })
    } finally {
      if (this._abortSignal === signal) { this._abortSignal = null }
    }
  }

  cancel () {
    if (this._state === 'idle') { return }

    const run = this._run
    this._abortSignal?.abort()
    this._output.cancel()
    run?.recorder?.cancel()
    this._finishRun(run)
    this._transition('idle')
  }

  clearHistory () {
    if (this._state !== 'idle') { return null }
    return this._history.clear()
  }

  _failLive (run, stage, error) {
    if (this._run !== run) { return }

    const failure = failureFrom(error, stage)
    const presentation = presentFailure(failure, stage)
    if (!presentation) {
      this._finishRun(run)
      this._transition('idle')
      return
    }

    console.error(`[toas] ${error?.stack ?? error}`)
    if (run.recording) { this._persistLive(run, 'error', failure) }

    this._finishRun(run)
    this._presentError(presentation)
    this._notifier.notify(presentation.summary, presentation.guidance)
  }

  _failRetry (run, originalEntry, error) {
    const failure = failureFrom(
      error,
      error?.category === 'configuration' ? 'configuration' : 'processing'
    )
    const presentation = presentFailure(failure, failure.stage)
    if (!presentation) {
      this._finishRun(run)
      this._transition('idle')
      return null
    }

    console.error(`[toas] ${error?.stack ?? error}`)
    const attempt = this._appendRetryAttempt(originalEntry, run, failure)
    this._finishRun(run)
    this._presentError(presentation)
    return attempt
  }

  _failDelivery (run, error) {
    console.error(`[toas] ${error?.stack ?? error}`)
    // Processing has already been persisted at this point. Delivery failure is
    // not a second processing failure and must not append another history row.
    this._finishRun(run)
    const summary = 'Text delivery failed'
    this._state = 'idle'
    this._overlay.render('error', summary)
    this._onStateChanged?.('error', summary)
    this._notifier.notify(summary, 'The voice input was processed, but the text could not be delivered.')
  }

  _persistLive (run, status, error = null) {
    if (!run.recording || !run.ownsRecording) { return false }

    if (run.private) {
      this._history.discardRecording(run.recording)
      run.ownsRecording = false
      return false
    }

    try {
      this._history.append(this._historyEntry(run, status, error))
      // Successful append transfers ownership to History. History may retain
      // the WAV or delete it immediately according to recording-limit.
      run.ownsRecording = false
      return true
    } catch (historyError) {
      console.error(`[toas] Could not save history: ${historyError.message}`)
      this._history.discardRecording(run.recording)
      run.ownsRecording = false
      return false
    }
  }

  _appendRetryAttempt (originalEntry, run, error = null) {
    const entry = this._historyEntry(run, error ? 'error' : 'ok', error)
    try {
      const attempt = this._history.appendAttempt(originalEntry, entry)
      if (!attempt) { console.warn('[toas] Retry attempt dropped: original voice input is gone') }
      return attempt
    } catch (historyError) {
      console.error(`[toas] Could not save retry attempt: ${historyError.message}`)
      return null
    }
  }

  _historyEntry (run, status, error = null) {
    const result = run.result || {}
    const trace = result.trace ?? error?.trace ?? []
    const transcribeTrace = trace.find(item => item.role === 'primary' || item.role === 'transcribe')
    const refineTrace = trace.find(item => item.role === 'refine')
    const entry = {
      id: GLib.uuid_string_random(),
      time: run.time,
      status
    }

    if (run.ownsRecording && run.recording) {
      entry.audio = {
        file: GLib.path_get_basename(run.recording.path),
        durationMs: run.recording.durationMs ?? 0,
        sampleRate: run.recording.sampleRate ?? DEFAULT_SAMPLE_RATE
      }
    }
    if (typeof result.text === 'string' && result.text) { entry.text = result.text }

    if (transcribeTrace) {
      entry.transcribe = historyStep(transcribeTrace)
      if (!entry.transcribe.text && !refineTrace && entry.text) {
        entry.transcribe.text = entry.text
      }
    } else if (error) {
      entry.transcribe = { error: historyError(error) }
    }

    if (refineTrace) { entry.refine = historyStep(refineTrace) }
    return entry
  }

  _presentError (presentation) {
    this._state = 'idle'
    this._overlay.render('error', presentation.summary)
    this._onStateChanged?.('error', presentation.summary)
  }

  _transition (state, message = '') {
    this._state = state
    this._overlay.render(state, message)
    this._onStateChanged?.(state, message)
  }

  _finishRun (run) {
    if (!run) { return }

    try {
      run.recorder?.destroy()
    } catch {
      // Best effort during extension disable or voice-input cancellation.
    }

    if (run.ownsRecording && run.recording) {
      this._history.discardRecording(run.recording)
      run.ownsRecording = false
    }
    if (this._run === run) { this._run = null }
  }

  destroy () {
    this._onStateChanged = null
    this._abortSignal?.abort()
    this._output?.cancel()
    this._run?.recorder?.cancel()
    this._finishRun(this._run)

    this._kernel = null
    this._output = null
    this._history = null
    this._overlay = null
    this._notifier = null
    this._settings = null
    this._abortSignal = null
    this._state = 'idle'
  }
}

function failureFrom (error, stage) {
  return {
    stage,
    message: error?.message ?? String(error),
    ...(error?.category ? { category: error.category } : {}),
    ...(error?.trace ? { trace: error.trace } : {})
  }
}

function historyStep (trace) {
  const step = {}
  if (trace.provider) { step.provider = trace.provider }
  if (trace.model) { step.model = trace.model }
  if (trace.text) { step.text = trace.text }
  if (Number.isFinite(trace.elapsedMs)) { step.latencyMs = Math.round(trace.elapsedMs) }
  if (trace.usage) { step.usage = trace.usage }
  if (trace.requestId) { step.requestId = trace.requestId }
  if (trace.responseId) { step.responseId = trace.responseId }
  if (trace.status === 'error' || trace.error) {
    step.error = historyError({
      category: trace.errorCategory,
      message: trace.error ?? 'Processing failed'
    })
  }
  return step
}

function historyError (error) {
  return {
    ...(error?.category ? { code: error.category } : {}),
    message: error?.message ?? String(error)
  }
}
