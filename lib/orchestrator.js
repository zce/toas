import GLib from 'gi://GLib'

import { AudioRecorder } from './audio.js'
import { ToasOverlayPresenter } from './overlay-presenter.js'
import { OpenAiCompatibleRefiner } from './refiner.js'
import { MimoChatTranscriber } from './transcriber.js'
import { DEFAULT_SAMPLE_RATE, resolveSampleRate } from './effective-config.js'
import { RecorderOutcomeError, RecorderOutcomeKind } from './recorder-outcome.js'

export class ToasOrchestrator {
  constructor ({
    settings,
    collaborators = {},
    onStateChanged = null,
    historyRepository = null
  }) {
    this._settings = settings
    this._history = collaborators.history
    this._privacy = collaborators.privacy ?? { enabled: false }
    this._transcriber = collaborators.transcriber ?? new MimoChatTranscriber(settings)
    this._refiner = collaborators.refiner ?? new OpenAiCompatibleRefiner(settings)
    this._overlay = collaborators.overlay
    this._output = collaborators.paster
    this._notifier = collaborators.notifier
    this._historyRepository = historyRepository
    this._onStateChanged = onStateChanged

    // The composition root (extension.js) wires everything explicitly; missing
    // collaborators are a programming error, so fail at construction.
    const missing = [
      ['history', this._history],
      ['overlay', this._overlay],
      ['paster', this._output],
      ['notifier', this._notifier]
    ].filter(([, value]) => !value).map(([name]) => name)

    if (missing.length > 0) {
      throw new Error(
                `ToasOrchestrator requires collaborators: ${missing.join(', ')}`
      )
    }

    this._recorderFactory =
            collaborators.recorderFactory ??
            ((directory, onLevel, onError, sampleRate) =>
              new AudioRecorder(directory, onLevel, onError, sampleRate))

    // Focus-mismatch notices share the notifier seam.
    if (this._output.setOnFocusMismatch && this._notifier) {
      this._output.setOnFocusMismatch(message =>
        this._notifier.notify('Copied to clipboard', message)
      )
    }

    this._state = 'idle'
    this._run = null
  }

  toggle () {
    if (this._state === 'idle') { this.begin() } else if (this._state === 'recording') { this.end() }
  }

  begin () {
    if (this._state !== 'idle') { return }

    const run = {
      createdAt: new Date().toISOString(),
      transcriptionMs: 0,
      refineMs: 0,
      // Snapshot at start: a private voice input stays private even if the
      // user flips the switch while processing runs. The overlay hint rides
      // the same snapshot so it can never decorate a non-private run.
      private: Boolean(this._privacy?.enabled)
    }
    this._overlay.setPrivate?.(run.private)
    run.recorder = this._recorderFactory(
      this._history.recordingsDirectory,
      level => {
        if (this._run === run && this._state === 'recording') { this._overlay.setLevel(level) }
      },
      error => this._fail(run, 'recording', error),
      resolveSampleRate(this._settings ?? {})
    )

    this._run = run
    this._overlay.resetLevels?.()
    this._transition('recording')
    run.recorder.start().catch(error => this._fail(run, 'recording', error))
  }

  async end () {
    if (this._state !== 'recording') { return }

    const run = this._run
    // Closing the recorder takes time (pw-record must exit after SIGINT), and
    // the next stage is only known once stop() resolves: short taps and
    // cancels return to idle without ever transcribing. Freeze the recording
    // visuals instead of promising a processing stage that may never start,
    // while keeping the state off 'recording' so a second toggle cannot
    // re-enter.
    this._state = 'processing'

    try {
      const outcome = await run.recorder.stop()
      if (this._run !== run) { return }

      if (outcome.kind === RecorderOutcomeKind.SHORT_TAP) {
        this._finishRun(run)
        this._transition('idle')
        return
      }

      if (outcome.kind === RecorderOutcomeKind.CANCELLED) {
        this._finishRun(run, true)
        this._transition('idle')
        return
      }

      if (outcome.kind === RecorderOutcomeKind.CAPTURE_FAILURE) {
        throw new RecorderOutcomeError(outcome)
      }

      run.recording = outcome.recording

      // Only now is transcription actually about to start; short taps and
      // cancels never reach this line.
      this._transition('transcribing')

      if (outcome.kind === RecorderOutcomeKind.SIZE_LIMIT) {
        // The user is told the recording was truncated before feedback for
        // the processing itself arrives.
        this._notifier.notify(
          'Recording limit reached',
          'The recording hit its cap, so it was cut off and is being processed.'
        )
      }

      // Lock the paste target now: the window focused when the user stopped
      // recording is the window that wanted the text.
      this._output.captureFocusedWindow?.()

      await this._process(run)
    } catch (error) {
      this._fail(run, 'recording', error)
    }
  }

  async _process (run, options = {}) {
    let stage = 'transcription'

    try {
      run.transcription = {
        model: this._transcriber.model,
        endpoint: this._transcriber.endpoint,
        language: this._transcriber.language,
        finishReason: null,
        usage: null,
        responseModel: null,
        responseId: null
      }
      let startedAt = GLib.get_monotonic_time()
      try {
        run.transcription = await this._transcriber.transcribe(
          run.recording,
          run.transcription.model
        )
        run.transcript = run.transcription.text?.trim()
      } finally {
        run.transcriptionMs = elapsedMs(startedAt)
      }

      if (this._run !== run) { return }
      if (!run.transcript) { throw new Error('No speech was recognized') }

      run.output = run.transcript
      const refineRequested = {
        model: this._refiner.model,
        endpoint: this._refiner.endpoint
      }
      run.refine = {
        ran: false,
        reason: this._refiner.enabled ? null : 'disabled',
        ...refineRequested,
        finishReason: null,
        usage: null,
        responseModel: null,
        responseId: null
      }
      run.refineMs = 0

      if (this._refiner.enabled) {
        stage = 'refine'
        this._transition('refining')
        startedAt = GLib.get_monotonic_time()
        try {
          run.refine = await this._refiner.refine(
            run.transcript,
            refineRequested.model
          )
          run.output = run.refine.text
        } catch (error) {
          if (this._run !== run) { return }
          run.warning = { stage: 'refine', message: error.message }
          console.warn(
                        `[toas] Refine failed, using transcript: ${error.message}`
          )
          run.output = run.transcript
          run.refine = {
            ran: true,
            reason: null,
            ...refineRequested,
            finishReason: null,
            usage: null,
            responseModel: null,
            responseId: null
          }
        }
        run.refineMs = elapsedMs(startedAt)
      }

      if (this._run !== run) { return }

      if (options.skipOutput) {
        // Retry path: save as a linked attempt, never paste, no recorder to
        // finish.
        run.savedAttempt = this._saveAttempt(run)
        this._transition('idle')
        return
      }

      stage = 'output'
      this._transition('outputting')
      await this._output.write(run.output)
      if (this._run !== run) { return }

      if (!this._saveHistory(run, 'ok')) { this._history.discardRecording(run.recording) }
      this._finishRun(run)

      // Refine fallback is a soft warning, not a session failure: the output
      // was still inserted, just unpolished.
      if (run.warning?.stage === 'refine') {
        this._notifier.notify(
          'Inserted the raw transcript',
          'Polishing failed, so the unedited transcription was used.'
        )
      }

      this._transition('idle')
    } catch (error) {
      this._fail(run, stage, error)
    }
  }

  cancel () {
    if (this._state === 'idle') { return }

    const run = this._run
    this._transcriber.cancel()
    this._refiner.cancel()
    this._output.cancel?.()
    run?.recorder?.cancel?.()
    // A retry does not own the original session's audio; never discard it.
    this._finishRun(run, !run?.isRetry)
    this._transition('idle')
  }

  // Reruns transcription (and refine) on a retained recording from a failed
  // history session. No recorder is started and nothing is pasted; the result
  // is appended as a linked attempt in history. Returns the attempt record or
  // null when another session is active.
  async retry (originalEntry) {
    if (this._state !== 'idle') { return null }

    const audio = this._historyRepository?.resolveAudio(originalEntry)
    if (!audio?.available || !audio.path) { return null }

    const run = {
      createdAt: new Date().toISOString(),
      transcriptionMs: 0,
      refineMs: 0,
      isRetry: true,
      originalId: originalEntry.id,
      recording: {
        id: originalEntry.id,
        path: audio.path,
        mimeType: 'audio/wav',
        sampleRate: originalEntry.sampleRate ?? DEFAULT_SAMPLE_RATE,
        channels: 1,
        durationMs: originalEntry.durationMs ?? 0
      }
    }

    this._run = run
    // A retry never starts from a private voice input; its decoration is
    // explicitly off even when the switch is on.
    this._overlay.setPrivate?.(false)
    this._transition('transcribing')

    try {
      await this._processRetry(run)
    } catch (error) {
      this._fail(run, 'transcription', error)
    }

    return run.savedAttempt ?? null
  }

  async _processRetry (run) {
    try {
      // Reuse the normal processing path but skip output; the run has no
      // recorder and retry never pastes.
      await this._process(run, { skipOutput: true })
    } finally {
      if (this._run === run) { this._run = null }
      this._state = 'idle'
    }
  }

  clearHistory () {
    if (this._state !== 'idle') { return null }

    return this._history.clear()
  }

  _fail (run, stage, error) {
    if (this._run !== run) { return }

    console.error(`[toas] ${error?.stack ?? error}`)

    let message = error?.message ?? String(error)
    let notification = {
      title: 'Voice input failed',
      body: `${message} — check your connection and settings, then try again.`
    }

    if (error instanceof RecorderOutcomeError) {
      const outcome = error.outcome
      message = outcome.error?.message ?? message
      notification = {
        title: 'Recording failed',
        body: `${message} — check that your microphone is available.`
      }
    }

    if (run.isRetry) {
      // Retry failures append a linked attempt and keep the original record
      // untouched; the recording is not ours to discard.
      run.savedAttempt = this._saveAttempt(run, {
        stage,
        message
      })
      this._state = 'idle'
      if (this._run === run) { this._run = null }
      this._overlay.render('error', message)
      this._onStateChanged?.('error', message)
      return
    }

    if (run.recording) {
      const saved = this._saveHistory(run, 'error', {
        stage,
        message
      })
      if (!saved) { this._history.discardRecording(run.recording) }
    }

    this._state = 'idle'
    this._finishRun(run)
    this._overlay.render('error', message)
    this._onStateChanged?.('error', message)
    this._notifier.notify(notification.title, notification.body)
  }

  // Appends a retry attempt linked to the original failed session. Uses the
  // repository when available so attempts are numbered and excluded from list();
  // falls back to a plain append otherwise.
  _saveAttempt (run, error = null) {
    const transcription = run.transcription ?? {}
    const refine = run.refine ?? {}
    const original = this._historyRepository?.get(run.originalId)

    const attempt = {
      v: 2,
      id: GLib.uuid_string_random(),
      createdAt: run.createdAt,
      durationMs: run.recording?.durationMs ?? 0,
      status: error ? 'error' : 'ok',
      // A retry borrows the original session's recording; the attempt does
      // not own another copy or count against recording retention.
      audio: null,
      sampleRate: run.recording?.sampleRate ?? null,
      transcript: run.transcript ?? null,
      output: run.output ?? null,
      transcription: {
        model: transcription.model || null,
        endpoint: transcription.endpoint || null,
        language: transcription.language || null,
        elapsedMs: run.transcriptionMs,
        finishReason: transcription.finishReason || null,
        usage: transcription.usage ?? null,
        responseModel: transcription.responseModel || null,
        responseId: transcription.responseId || null
      },
      refine: {
        ran: refine.ran ?? false,
        reason: refine.reason || null,
        model: refine.model || null,
        endpoint: refine.endpoint || null,
        elapsedMs: run.refineMs,
        finishReason: refine.finishReason || null,
        usage: refine.usage ?? null,
        responseModel: refine.responseModel || null,
        responseId: refine.responseId || null
      },
      ...(run.warning ? { warning: run.warning } : {}),
      ...(error ? { error } : {})
    }

    try {
      if (original && this._historyRepository) {
        return this._historyRepository.appendAttempt(original, attempt)
      }
      // No original to link to: do not append a ghost standalone session.
      console.warn('[toas] Retry attempt dropped: original voice input is gone')
      return null
    } catch (historyError) {
      console.error(`[toas] Could not save retry attempt: ${historyError.message}`)
      return null
    }
  }

  _saveHistory (run, status, error = null) {
    // A private voice input is never retained. Returning false makes every
    // caller discard the recording immediately, mirroring a history write
    // failure.
    if (run.private) { return false }

    const transcription = run.transcription ?? {}
    const refine = run.refine ?? {}

    try {
      this._history.append({
        v: 2,
        id: run.recording.id,
        createdAt: run.createdAt,
        durationMs: run.recording.durationMs,
        status,
        audio: `recordings/${GLib.path_get_basename(run.recording.path)}`,
        sampleRate: run.recording.sampleRate ?? null,
        transcript: run.transcript ?? null,
        output: run.output ?? null,
        transcription: {
          model: transcription.model || null,
          endpoint: transcription.endpoint || null,
          language: transcription.language || null,
          elapsedMs: run.transcriptionMs,
          finishReason: transcription.finishReason || null,
          usage: transcription.usage ?? null,
          responseModel: transcription.responseModel || null,
          responseId: transcription.responseId || null
        },
        refine: {
          ran: refine.ran ?? false,
          reason: refine.reason || null,
          model: refine.model || null,
          endpoint: refine.endpoint || null,
          elapsedMs: run.refineMs,
          finishReason: refine.finishReason || null,
          usage: refine.usage ?? null,
          responseModel: refine.responseModel || null,
          responseId: refine.responseId || null
        },
        ...(run.warning ? { warning: run.warning } : {}),
        ...(error ? { error } : {})
      })
      return true
    } catch (historyError) {
      console.error(
                `[toas] Could not save history: ${historyError.message}`
      )
      return false
    }
  }

  _transition (state) {
    this._state = state
    this._overlay.render(this._state)
    this._onStateChanged?.(this._state)
  }

  _finishRun (run, discardRecording = false) {
    if (!run) { return }

    try {
      run.recorder?.destroy()
    } catch {
      // Best effort during extension disable or session cancellation.
    }

    if (discardRecording) { this._history.discardRecording(run.recording) }
    if (this._run === run) { this._run = null }
  }

  destroy () {
    this._onStateChanged = null
    // Stop in-flight network work; the composition root destroys collaborators.
    this._transcriber?.cancel()
    this._refiner?.cancel()
    this._finishRun(this._run, true)

    // Collaborators are owned by the composition root (extension.js), so the
    // orchestrator never destroys them; it only drops references.
    this._transcriber = null
    this._refiner = null
    this._output = null
    this._history = null
    this._overlay = null
    this._notifier = null
    this._settings = null
    this._state = 'idle'
  }
}

function elapsedMs (startedAt) {
  return Math.round((GLib.get_monotonic_time() - startedAt) / 1000)
}
