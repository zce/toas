import GLib from 'gi://GLib'

import { AudioRecorder } from './audio.js'
import { ToasOverlayPresenter } from './overlay-presenter.js'
import { OpenAiCompatibleRefiner } from './refiner.js'
import { MimoChatTranscriber } from './transcriber.js'
import { RecorderOutcomeError, RecorderOutcomeKind } from './recorder-outcome.js'

export class ToasOrchestrator {
  constructor ({
    settings,
    collaborators = {},
    onStateChanged = null
  }) {
    this._settings = settings
    this._history = collaborators.history
    this._transcriber = collaborators.transcriber ?? new MimoChatTranscriber(settings)
    this._refiner = collaborators.refiner ?? new OpenAiCompatibleRefiner(settings)
    this._createdTranscriber = !collaborators.transcriber
    this._createdRefiner = !collaborators.refiner
    this._overlay = collaborators.overlay
    this._output = collaborators.paster
    this._notifier = collaborators.notifier
    if (!this._notifier) {
      throw new Error(
        'ToasOrchestrator requires a notifier collaborator (see extension.js)'
      )
    }
    this._onStateChanged = onStateChanged

    this._recorderFactory =
            collaborators.recorderFactory ??
            ((directory, onLevel, onError) =>
              new AudioRecorder(directory, onLevel, onError))

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
      refineMs: 0
    }
    run.recorder = this._recorderFactory(
      this._history.recordingsDirectory,
      level => {
        if (this._run === run && this._state === 'recording') { this._overlay.setLevel(level) }
      },
      error => this._fail(run, 'recording', error)
    )

    this._run = run
    this._transition('recording')
    run.recorder.start().catch(error => this._fail(run, 'recording', error))
  }

  async end () {
    if (this._state !== 'recording') { return }

    const run = this._run
    this._transition('processing')

    try {
      const outcome = await run.recorder.stop()
      if (this._run !== run) { return }

      if (outcome.kind === RecorderOutcomeKind.SHORT_TAP) {
        this._finishRun(run)
        this._state = 'idle'
        this._transition('idle')
        return
      }

      if (outcome.kind === RecorderOutcomeKind.CAPTURE_FAILURE) {
        throw new RecorderOutcomeError(outcome)
      }

      run.recording = outcome.recording

      await this._process(run)
    } catch (error) {
      this._fail(run, 'recording', error)
    }
  }

  async _process (run) {
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

      stage = 'output'
      this._transition('outputting')
      await this._output.write(run.output)
      if (this._run !== run) { return }

      if (!this._saveHistory(run, 'ok')) { this._history.discardRecording(run.recording) }
      this._finishRun(run)
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
    this._finishRun(run, true)
    this._transition('idle')
  }

  clearHistory () {
    if (this._state !== 'idle') { return null }

    return this._history.clear()
  }

  _fail (run, stage, error) {
    if (this._run !== run) { return }

    console.error(`[toas] ${error?.stack ?? error}`)

    let message = error?.message ?? String(error)
    let notification = { title: 'Voice input failed', body: message }

    if (error instanceof RecorderOutcomeError) {
      const outcome = error.outcome
      message = outcome.error?.message ?? message
      notification = {
        title: 'Recording failed',
        body: message
      }
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

  _saveHistory (run, status, error = null) {
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
    this._state = state === 'processing' || state === 'transcribing'
      ? 'transcribing'
      : state
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
    this._transcriber?.cancel()
    this._refiner?.cancel()
    this._output?.cancel?.()
    this._notifier?.cancel?.()
    this._finishRun(this._run, true)

    // Collaborators are owned by the composition root (extension.js), not by
    // the orchestrator, so destroy only what the orchestrator created.
    if (this._createdTranscriber) { this._transcriber?.destroy() }
    if (this._createdRefiner) { this._refiner?.destroy() }
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