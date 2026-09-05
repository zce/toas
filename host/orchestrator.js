import GLib from 'gi://GLib'

import {
  AudioRecorder,
  DEFAULT_SAMPLE_RATE,
  RecorderOutcomeError,
  RecorderOutcomeKind,
  resolveSampleRate
} from './audio.js'
import { AttemptSignal } from './transport.js'

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
    this._kernel = collaborators.kernel
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
      ['notifier', this._notifier],
      ['kernel', this._kernel]
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
    this._abortSignal = null
  }

  toggle () {
    if (this._state === 'idle') { this.begin() } else if (this._state === 'recording') { this.end() }
  }

  begin () {
    if (this._state !== 'idle') { return }

    const run = {
      createdAt: new Date().toISOString(),
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

      // Only now is processing actually about to start; short taps and
      // cancels never reach this line.
      this._transition('processing')

      if (outcome.kind === RecorderOutcomeKind.SIZE_LIMIT) {
        // The user is told the recording was truncated before feedback for
        // the processing itself arrives.
        this._notifier.notify(
          'Recording limit reached',
          'The recording hit its cap, so it was cut off and is being processed.'
        )
      }

      // Lock the paste target BEFORE any async preparation (audio loading,
      // config snapshot): the window focused when the user stopped recording
      // is the window that wanted the text, and later awaits must not change it.
      this._output.captureFocusedWindow?.()

      await this._processWithKernel(run)
    } catch (error) {
      this._fail(run, 'recording', error)
    }
  }

  async _processWithKernel (run, options = {}) {
    const signal = new AttemptSignal()
    this._abortSignal = signal

    try {
      // The kernel snapshot (Config, secrets, Context, audio) happens inside
      // this call, after the output target is already captured.
      const result = await this._kernel.run(run.recording, signal)

      if (this._run !== run) { return }

      run.result = result
      run.output = result.text

      if (options.skipOutput) {
        run.savedAttempt = this._saveAttemptFromResult(run)
        this._transition('idle')
        return
      }

      if (!this._saveHistoryFromResult(run, 'ok')) {
        this._history.discardRecording(run.recording)
      }

      this._transition('outputting')
      await this._output.write(run.output)
      if (this._run !== run) { return }
      this._finishRun(run)

      // Refine fallback is a soft warning, not a voice-input failure: the
      // primary result was still inserted, just unrefined.
      if (result.warning?.type === 'refine-failed') {
        this._notifier.notify(
          'Inserted the primary result',
          'Refine failed, so the unrefined primary text was used.'
        )
      }

      this._transition('idle')
    } catch (error) {
      if (this._run !== run) { return }

      const stage = error.category === 'configuration' ? 'configuration' : 'processing'
      this._fail(run, stage, error)
    } finally {
      this._abortSignal = null
    }
  }

  cancel () {
    if (this._state === 'idle') { return }

    const run = this._run
    this._abortSignal?.abort()
    this._output.cancel?.()
    run?.recorder?.cancel?.()

    // A retry does not own the original session's audio; never discard it.
    this._finishRun(run, !run?.isRetry)
    this._transition('idle')
  }

  // Reruns processing on a retained recording from a failed history session.
  // No recorder is started and nothing is pasted; the result is appended as
  // a linked attempt. Retry uses the current Config/Context/secrets snapshot,
  // never a historical one.
  async retry (originalEntry) {
    if (this._state !== 'idle') { return null }

    const audio = this._historyRepository?.resolveAudio(originalEntry)
    if (!audio?.available || !audio.path) { return null }

    const run = {
      createdAt: new Date().toISOString(),
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
    this._transition('processing')

    try {
      await this._processWithKernel(run, { skipOutput: true })
    } catch (error) {
      this._fail(run, 'processing', error)
    } finally {
      if (this._run === run) { this._run = null }
      this._state = 'idle'
    }

    return run.savedAttempt ?? null
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
      run.savedAttempt = this._saveAttemptFromResult(run, {
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
      const saved = this._saveHistoryFromResult(run, 'error', {
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

  // Final-text/Trace history shape (spec #22 section 14): one text field plus
  // the physical Trace of the calls that actually ran.
  _historyEntryFromResult (run, status, error = null) {
    const result = run.result || {}

    return {
      id: GLib.uuid_string_random(),
      createdAt: run.createdAt,
      durationMs: run.recording?.durationMs ?? 0,
      status,
      audio: run.isRetry
        ? null
        : `recordings/${GLib.path_get_basename(run.recording.path)}`,
      sampleRate: run.recording?.sampleRate ?? null,
      text: result.text || null,
      trace: result.trace || [],
      ...(result.warning ? { warning: result.warning } : {}),
      ...(error ? { error: { stage: error.stage, message: error.message } } : {})
    }
  }

  _saveAttemptFromResult (run, error = null) {
    const original = this._historyRepository?.get(run.originalId)

    const attempt = {
      ...this._historyEntryFromResult(run, error ? 'error' : 'ok', error),
      audio: null,
      attemptOf: original?.id
    }

    try {
      if (original && this._historyRepository) {
        return this._historyRepository.appendAttempt(original, attempt)
      }
      console.warn('[toas] Retry attempt dropped: original voice input is gone')
      return null
    } catch (historyError) {
      console.error(`[toas] Could not save retry attempt: ${historyError.message}`)
      return null
    }
  }

  _saveHistoryFromResult (run, status, error = null) {
    // A private voice input is never retained. Returning false makes every
    // caller discard the recording immediately, mirroring a history write
    // failure.
    if (run.private) { return false }

    try {
      this._history.append(this._historyEntryFromResult(run, status, error))
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
    this._abortSignal?.abort()
    this._finishRun(this._run, true)

    // Collaborators are owned by the composition root (extension.js), so the
    // orchestrator never destroys them; it only drops references.
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
