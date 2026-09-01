import GLib from 'gi://GLib'

import { AudioRecorder } from './audio.js'
import { HistoryStore } from './history.js'
import { FocusedInputSink } from './input.js'
import { ToasOverlay } from './overlay.js'
import { OpenAiCompatibleRefiner } from './refiner.js'
import { MimoChatTranscriber } from './transcriber.js'

export class ToasOrchestrator {
  constructor (settings, onStateChanged = null) {
    this._settings = settings
    this._history = new HistoryStore(settings)
    this._transcriber = new MimoChatTranscriber(settings)
    this._refiner = new OpenAiCompatibleRefiner(settings)
    this._output = new FocusedInputSink(settings)
    this._overlay = new ToasOverlay()
    this._onStateChanged = onStateChanged
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
    run.recorder = new AudioRecorder(
      this._history.recordingsDirectory,
      this._settings.get_string('recording-format'),
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
    let stage = 'recording'
    this._transition('transcribing')

    try {
      run.recording = await run.recorder.stop()
      if (this._run !== run) { return }

      stage = 'transcription'
      run.transcriptionModel = this._transcriber.model
      let startedAt = GLib.get_monotonic_time()
      try {
        run.transcript = (
          await this._transcriber.transcribe(
            run.recording,
            run.transcriptionModel
          )
        )?.trim()
      } finally {
        run.transcriptionMs = elapsedMs(startedAt)
      }

      if (this._run !== run) { return }
      if (!run.transcript) { throw new Error('No speech was recognized') }

      run.output = run.transcript
      if (this._refiner.enabled) {
        stage = 'refine'
        run.refineModel = this._refiner.model
        this._transition('refining')
        startedAt = GLib.get_monotonic_time()
        try {
          run.output = await this._refiner.refine(
            run.transcript,
            run.refineModel
          )
        } catch (error) {
          if (this._run !== run) { return }
          run.warning = { stage: 'refine', message: error.message }
          console.warn(
                        `[toas] Refine failed, using transcript: ${error.message}`
          )
          run.output = run.transcript
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
    if (run.recording) {
      const saved = this._saveHistory(run, 'error', {
        stage,
        message: error?.message ?? String(error)
      })
      if (!saved) { this._history.discardRecording(run.recording) }
    }

    this._state = 'idle'
    this._finishRun(run)
    const message = error?.message ?? String(error)
    this._overlay.render('error', message)
    this._onStateChanged?.('error', message)
  }

  _saveHistory (run, status, error = null) {
    try {
      this._history.append({
        v: 1,
        id: run.recording.id,
        createdAt: run.createdAt,
        durationMs: run.recording.durationMs,
        status,
        audio: `recordings/${GLib.path_get_basename(run.recording.path)}`,
        transcript: run.transcript ?? null,
        output: run.output ?? null,
        transcription: {
          model: run.transcriptionModel,
          elapsedMs: run.transcriptionMs
        },
        refine: {
          model: run.refineModel || null,
          elapsedMs: run.refineMs
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
    this._overlay.render(state)
    this._onStateChanged?.(state)
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
    this._finishRun(this._run, true)
    this._transcriber?.destroy()
    this._refiner?.destroy()
    this._output?.destroy()
    this._history?.destroy()
    this._overlay?.destroy()

    this._transcriber = null
    this._refiner = null
    this._output = null
    this._history = null
    this._overlay = null
    this._settings = null
    this._state = 'idle'
  }
}

function elapsedMs (startedAt) {
  return Math.round((GLib.get_monotonic_time() - startedAt) / 1000)
}
