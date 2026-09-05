import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

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
    const line = new TextEncoder().encode(`${JSON.stringify(entry)}\n`)
    const file = Gio.File.new_for_path(this._historyPath)
    const stream = file.append_to(Gio.FileCreateFlags.PRIVATE, null)
    try {
      stream.write_all(line, null)
    } finally {
      stream.close(null)
    }

    this._pruneSafely()
  }

  clear () {
    const sessions = this._readEntries().length

    if (GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) { GLib.file_set_contents(this._historyPath, '') }

    this._forEachRecording(name =>
      this.discardRecording({
        path: GLib.build_filenamev([this.recordingsDirectory, name])
      })
    )
    return sessions
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
    const entries = this._readEntries()
    const textLimit = this._settings.get_uint('history-limit')

    const removed = entries.slice(0, Math.max(0, entries.length - textLimit))
    const retained = entries.slice(-textLimit)

    for (const entry of removed) { this._discardEntryRecording(entry) }

    const recordingLimit = this._settings.get_uint(
      'recording-limit'
    )
    const withAudio = retained
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.audio)
    const dropCount = Math.max(0, withAudio.length - recordingLimit)

    for (const { entry, index } of withAudio.slice(0, dropCount)) {
      this._discardEntryRecording(entry)
      retained[index] = { ...entry, audio: null }
    }

    if (removed.length > 0 || dropCount > 0) {
      const contents = retained.length
        ? `${retained.map(entry => JSON.stringify(entry)).join('\n')}\n`
        : ''
      GLib.file_set_contents(this._historyPath, contents)
    }
  }

  _discardEntryRecording (entry) {
    if (!entry.audio) { return }

    this.discardRecording({
      path: GLib.build_filenamev([this.stateDirectory, entry.audio])
    })
  }

  _removeOrphanedRecordings () {
    const referenced = new Set(
      this._readEntries()
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

  _readEntries () {
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

  // Public read access for HistoryRepository; same semantics as _readEntries.
  readEntries () {
    return this._readEntries()
  }

  destroy () {
    if (this._settingsChangedId) { this._settings.disconnect(this._settingsChangedId) }
    this._settingsChangedId = 0
    this._settings = null
  }
}

// History repository: bounded, safe queries over the session JSONL plus
// linked retry attempts. Pure GLib, no Shell imports.
//
// Design notes:
// - list() reads the file once, returns newest first, skips malformed lines.
// - Attempts are appended (never rewritten) with attemptOf linking to the
//   original session id; the original record is immutable.
// - Audio resolution checks file existence without reading contents.

const DEFAULT_PAGE_SIZE = 30

export class HistoryRepository {
  constructor (store) {
    this._store = store
  }

  // Newest-first page of session metadata. `after` is the id of the last
  // entry of the previous page, enabling keyset pagination without indexes.
  list ({ limit = DEFAULT_PAGE_SIZE, beforeId = null } = {}) {
    const entries = this._store.readEntries()
    const newestFirst = [...entries].reverse()
    const startIndex = beforeId
      ? newestFirst.findIndex(entry => entry.id === beforeId) + 1
      : 0

    if (beforeId && startIndex === 0) { return [] }

    return newestFirst
      .slice(startIndex)
      .filter(entry => !entry.attemptOf)
      .slice(0, limit)
  }

  get (id) {
    return this._store.readEntries().find(entry => entry.id === id) ?? null
  }

  // Attempts linked to a session, oldest first.
  attemptsOf (sessionId) {
    return this._store
      .readEntries()
      .filter(entry => entry.attemptOf === sessionId)
  }

  // Appends a retry attempt linked to a failed original. The original record
  // is never modified.
  appendAttempt (original, entry) {
    const attempts = this.attemptsOf(original.id)
    const attempt = {
      ...entry,
      id: entry.id ?? GLib.uuid_string_random(),
      attemptOf: original.id,
      attemptNumber: attempts.length + 1
    }
    this._store.append(attempt)
    return attempt
  }

  // Resolves the audio path only if the file still exists on disk. Returns
  // { available, path } without reading any bytes.
  resolveAudio (entry) {
    if (!entry?.audio) { return { available: false, path: null } }

    const path = GLib.build_filenamev([
      this._store.stateDirectory,
      entry.audio
    ])
    const exists = GLib.file_test(path, GLib.FileTest.EXISTS) &&
      !GLib.file_test(path, GLib.FileTest.IS_DIR)
    return { available: exists, path: exists ? path : null }
  }
}

// Pure formatting helpers for history UI; imported by headless tests and the
// Shell-side indicator menu.

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

// Final text of a history entry: entries store Result text; the legacy
// output/transcript fallbacks exist only for entries written before the
// Result/Trace history shape.
export function previewText (entry) {
  const text = extractText(entry).replace(/\s+/g, ' ').trim()
  if (!text) { return '(no text)' }
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
}

export function extractText (entry) {
  return entry.text || entry.output || entry.transcript || ''
}
