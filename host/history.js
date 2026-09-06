import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { presentFailure } from './feedback.js'

const DEFAULT_PAGE_SIZE = 30

export class HistoryStore {
  constructor (settings) {
    this._settings = settings
    this.stateDirectory = GLib.build_filenamev([
      GLib.get_user_state_dir(),
      'toas'
    ])
    this.recordingsDirectory = GLib.build_filenamev([
      this.stateDirectory,
      'recordings'
    ])
    this._historyPath = GLib.build_filenamev([
      this.stateDirectory,
      'history.jsonl'
    ])

    GLib.mkdir_with_parents(this.recordingsDirectory, 0o700)
    this._settingsChangedId = this._settings.connect(
      'changed',
      (_settings, key) => {
        if (key === 'history-limit' || key === 'recording-limit') {
          this._pruneSafely()
        }
      }
    )
    this._pruneSafely()
    this._removeOrphanedRecordings()
  }

  append (entry) {
    let retainedEntry = entry
    if (entry.audio && this._settings.get_uint('recording-limit') === 0) {
      this._discardEntryRecording(entry)
      retainedEntry = { ...entry, audio: null }
    }

    const line = new TextEncoder().encode(`${JSON.stringify(retainedEntry)}\n`)
    const file = Gio.File.new_for_path(this._historyPath)
    const stream = file.append_to(Gio.FileCreateFlags.PRIVATE, null)
    try {
      stream.write_all(line, null)
    } finally {
      stream.close(null)
    }

    this._pruneSafely()
    return retainedEntry
  }

  // Newest-first logical voice inputs. Retry attempts are projected onto their
  // parent from the same file snapshot, so opening History never reparses the
  // JSONL once per row.
  list ({ limit = DEFAULT_PAGE_SIZE, beforeId = null } = {}) {
    const entries = this.readEntries()
    const attempts = new Map()
    for (const entry of entries) {
      if (!entry.attemptOf) { continue }
      const list = attempts.get(entry.attemptOf) ?? []
      list.push(entry)
      attempts.set(entry.attemptOf, list)
    }

    const newestFirst = entries.filter(entry => !entry.attemptOf).reverse()
    const startIndex = beforeId
      ? newestFirst.findIndex(entry => entry.id === beforeId) + 1
      : 0
    if (beforeId && startIndex === 0) { return [] }

    return newestFirst
      .slice(startIndex, startIndex + limit)
      .map(entry => projectLatestAttempt(entry, attempts.get(entry.id) ?? []))
  }

  get (id) {
    return this.readEntries().find(entry => entry.id === id) ?? null
  }

  appendAttempt (original, entry) {
    const entries = this.readEntries()
    const current = entries.find(candidate => candidate.id === original?.id && !candidate.attemptOf)
    if (!current) { return null }

    const attempt = {
      ...entry,
      id: entry.id ?? GLib.uuid_string_random(),
      attemptOf: current.id,
      attemptNumber: entries.filter(candidate => candidate.attemptOf === current.id).length + 1,
      audio: null
    }
    this.append(attempt)
    return attempt
  }

  resolveAudio (entry) {
    if (!entry?.audio) { return { available: false, path: null } }

    const path = GLib.build_filenamev([this.stateDirectory, entry.audio])
    const exists = GLib.file_test(path, GLib.FileTest.EXISTS) &&
      !GLib.file_test(path, GLib.FileTest.IS_DIR)
    return { available: exists, path: exists ? path : null }
  }

  clear () {
    const entries = this.readEntries()
    const count = entries.filter(entry => !entry.attemptOf).length

    if (GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) {
      GLib.file_set_contents(this._historyPath, '')
    }

    this._forEachRecording(name =>
      this.discardRecording({
        path: GLib.build_filenamev([this.recordingsDirectory, name])
      })
    )
    return count
  }

  discardRecording (recording) {
    if (!recording?.path) { return true }

    try {
      Gio.File.new_for_path(recording.path).delete(null)
      return true
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) { return true }
      console.warn(`[toas] Could not remove recording: ${error.message}`)
      return false
    }
  }

  _pruneSafely () {
    try {
      this._prune()
    } catch (error) {
      console.error(`[toas] Could not prune history: ${error.message}`)
    }
  }

  _prune () {
    const entries = this.readEntries()
    const historyLimit = this._settings.get_uint('history-limit')
    const roots = entries.filter(entry => !entry.attemptOf)
    const retainedRoots = historyLimit > 0 ? roots.slice(-historyLimit) : []
    const retainedRootIds = new Set(retainedRoots.map(entry => entry.id))
    const removedRoots = roots.filter(entry => !retainedRootIds.has(entry.id))

    for (const entry of removedRoots) { this._discardEntryRecording(entry) }

    // Attempts are children of a logical voice input and consume no retention
    // slots. Orphaned attempts disappear with their parent.
    const retained = entries.filter(entry =>
      entry.attemptOf
        ? retainedRootIds.has(entry.attemptOf)
        : retainedRootIds.has(entry.id)
    )

    const recordingLimit = this._settings.get_uint('recording-limit')
    const rootsWithAudio = retained
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !entry.attemptOf && entry.audio)
    const dropCount = Math.max(0, rootsWithAudio.length - recordingLimit)

    for (const { entry, index } of rootsWithAudio.slice(0, dropCount)) {
      this._discardEntryRecording(entry)
      retained[index] = { ...entry, audio: null }
    }

    if (retained.length !== entries.length || dropCount > 0) {
      this._writeEntries(retained)
    }
  }

  _writeEntries (entries) {
    const contents = entries.length
      ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`
      : ''
    GLib.file_set_contents(this._historyPath, contents)
  }

  _discardEntryRecording (entry) {
    if (!entry.audio) { return }

    this.discardRecording({
      path: GLib.build_filenamev([this.stateDirectory, entry.audio])
    })
  }

  _removeOrphanedRecordings () {
    const referenced = new Set(
      this.readEntries()
        .map(entry => entry.audio)
        .filter(Boolean)
        .map(path => GLib.build_filenamev([this.stateDirectory, path]))
    )

    this._forEachRecording(name => {
      const path = GLib.build_filenamev([this.recordingsDirectory, name])
      if (!referenced.has(path)) { this.discardRecording({ path }) }
    })
  }

  _forEachRecording (callback) {
    const directory = Gio.File.new_for_path(this.recordingsDirectory)
    const children = directory.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NONE,
      null
    )

    try {
      let info
      while ((info = children.next_file(null))) { callback(info.get_name()) }
    } finally {
      children.close(null)
    }
  }

  readEntries () {
    if (!GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) { return [] }

    const [, bytes] = GLib.file_get_contents(this._historyPath)
    return new TextDecoder()
      .decode(bytes)
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  }

  destroy () {
    if (this._settingsChangedId) { this._settings.disconnect(this._settingsChangedId) }
    this._settingsChangedId = 0
    this._settings = null
  }
}

const PREVIEW_MAX = 60

export function formatRelativeTime (isoString, nowMs = Date.now()) {
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) { return '' }

  const deltaSeconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (deltaSeconds < 60) { return 'just now' }
  if (deltaSeconds < 3600) { return `${Math.floor(deltaSeconds / 60)} min ago` }
  if (deltaSeconds < 86400) { return `${Math.floor(deltaSeconds / 3600)} h ago` }
  return `${Math.floor(deltaSeconds / 86400)} d ago`
}

export function formatDuration (ms) {
  const seconds = Math.round((ms ?? 0) / 1000)
  if (seconds < 60) { return `${seconds}s` }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export function projectLatestAttempt (entry, attempts = []) {
  const latest = attempts[attempts.length - 1]
  if (!latest) { return entry }

  return {
    ...entry,
    status: latest.status,
    text: latest.text ?? null,
    error: latest.status === 'error' ? (latest.error ?? null) : null,
    attemptNumber: latest.attemptNumber
  }
}

// output/transcript are compatibility fallbacks for older retained entries.
export function previewText (entry) {
  const text = extractText(entry).replace(/\s+/g, ' ').trim()
  if (!text && entry?.status === 'error' && entry.error) {
    return presentFailure(entry.error, entry.error.stage)?.summary ?? '(no text)'
  }
  if (!text) { return '(no text)' }
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
}

export function extractText (entry) {
  return entry.text || entry.output || entry.transcript || ''
}
