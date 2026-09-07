import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { presentFailure } from './feedback.js'

// Append-only JSONL history plus retained WAV recordings under the state
// directory. Entries carry one logical voice input per root id; retry
// attempts attach to their root and consume no retention slots.

const DEFAULT_PAGE_SIZE = 30

export class HistoryStore {
  constructor(settings) {
    this._settings = settings
    this._recent = null
    this.stateDirectory = GLib.build_filenamev([GLib.get_user_state_dir(), 'toas'])
    this.recordingsDirectory = GLib.build_filenamev([this.stateDirectory, 'recordings'])
    this._historyPath = GLib.build_filenamev([this.stateDirectory, 'history.jsonl'])

    GLib.mkdir_with_parents(this.recordingsDirectory, 0o700)
    this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
      if (key === 'history-limit' || key === 'recording-limit') {
        this._pruneSafely()
      }
    })
    // Pruning on open also produces the first page, and reaps recordings left
    // behind by an earlier crash or config change.
    const entries = this._pruneSafely()
    this._removeOrphanedRecordings(entries)
  }

  append(entry) {
    let retainedEntry = entry
    if (entry.audio?.file && this._settings.get_uint('recording-limit') === 0) {
      this._discardEntryRecording(entry)
      retainedEntry = withoutAudioFile(entry)
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

  // Newest-first logical voice inputs. The first page is already produced by
  // pruning, so normal menu opens avoid another synchronous file read/parse.
  list({ limit = DEFAULT_PAGE_SIZE, beforeId = null } = {}) {
    if (!beforeId && limit <= DEFAULT_PAGE_SIZE && this._recent) {
      return this._recent.slice(0, limit)
    }
    return listEntries(this.readEntries(), { limit, beforeId })
  }

  appendAttempt(original, entry) {
    const rootId = original?.retryOf ?? original?.id
    const recentRoot = this._recent?.find(candidate => candidate.id === rootId)
    const current = recentRoot ?? this.readEntries().find(candidate => candidate.id === rootId && !candidate.retryOf)
    if (!current) {
      return null
    }

    const attempt = {
      ...entry,
      id: entry.id ?? GLib.uuid_string_random(),
      retryOf: current.id
    }
    // The attempt borrows the original's recording, so it never carries its
    // own audio reference.
    delete attempt.audio
    this.append(attempt)
    return attempt
  }

  resolveAudio(entry) {
    const file = entry?.audio?.file
    if (!file) {
      return { available: false, path: null }
    }

    const path = GLib.build_filenamev([this.recordingsDirectory, file])
    const exists = GLib.file_test(path, GLib.FileTest.EXISTS) && !GLib.file_test(path, GLib.FileTest.IS_DIR)
    return { available: exists, path: exists ? path : null }
  }

  clear() {
    const entries = this.readEntries()
    const count = entries.filter(entry => !entry.retryOf).length

    if (GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) {
      GLib.file_set_contents(this._historyPath, '')
    }
    this._recent = []
    this._forEachRecording(name => this.discardRecording({ path: GLib.build_filenamev([this.recordingsDirectory, name]) }))
    return count
  }

  discardRecording(recording) {
    if (!recording?.path) {
      return true
    }

    try {
      Gio.File.new_for_path(recording.path).delete(null)
      return true
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
        return true
      }
      console.warn(`[toas] Could not remove recording: ${error.message}`)
      return false
    }
  }

  // Never throws: a broken history file must not take down the extension.
  _pruneSafely() {
    try {
      return this._prune()
    } catch (error) {
      this._recent = null
      console.error(`[toas] Could not prune history: ${error.message}`)
      return null
    }
  }

  _prune() {
    const entries = this.readEntries()
    const historyLimit = this._settings.get_uint('history-limit')
    const roots = entries.filter(entry => !entry.retryOf)
    const retainedRoots = historyLimit > 0 ? roots.slice(-historyLimit) : []
    const retainedRootIds = new Set(retainedRoots.map(entry => entry.id))
    const removedRoots = roots.filter(entry => !retainedRootIds.has(entry.id))

    for (const entry of removedRoots) {
      this._discardEntryRecording(entry)
    }

    // Retries consume no logical retention slots and disappear with their
    // root voice input.
    const retained = entries.filter(entry => (entry.retryOf ? retainedRootIds.has(entry.retryOf) : retainedRootIds.has(entry.id)))

    // The oldest retained recordings beyond the recording limit lose their
    // WAV but keep duration/sample-rate metadata and text.
    const recordingLimit = this._settings.get_uint('recording-limit')
    const rootsWithAudio = retained.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.retryOf && entry.audio?.file)
    const dropCount = Math.max(0, rootsWithAudio.length - recordingLimit)

    for (const { entry, index } of rootsWithAudio.slice(0, dropCount)) {
      this._discardEntryRecording(entry)
      retained[index] = withoutAudioFile(entry)
    }

    if (retained.length !== entries.length || dropCount > 0) {
      this._writeEntries(retained)
    }

    this._recent = listEntries(retained, { limit: DEFAULT_PAGE_SIZE })
    return retained
  }

  _writeEntries(entries) {
    const contents = entries.length ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n` : ''
    GLib.file_set_contents(this._historyPath, contents)
  }

  _discardEntryRecording(entry) {
    const file = entry.audio?.file
    if (!file) {
      return
    }

    this.discardRecording({ path: GLib.build_filenamev([this.recordingsDirectory, file]) })
  }

  // Deletes recordings no entry references. Pass the just-pruned entries to
  // avoid re-reading the file.
  _removeOrphanedRecordings(entries = null) {
    const referenced = new Set((entries ?? this.readEntries()).map(entry => entry.audio?.file).filter(Boolean))

    this._forEachRecording(name => {
      if (!referenced.has(name)) {
        this.discardRecording({ path: GLib.build_filenamev([this.recordingsDirectory, name]) })
      }
    })
  }

  _forEachRecording(callback) {
    const directory = Gio.File.new_for_path(this.recordingsDirectory)
    const children = directory.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, null)

    try {
      let info
      while ((info = children.next_file(null))) {
        callback(info.get_name())
      }
    } finally {
      children.close(null)
    }
  }

  readEntries() {
    if (!GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) {
      return []
    }

    // Malformed lines (a truncated write, for instance) are skipped rather
    // than failing every subsequent read.
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

  destroy() {
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId)
    }
    this._settingsChangedId = 0
    this._recent = null
    this._settings = null
  }
}

const PREVIEW_MAX = 60

export function formatRelativeTime(isoString, nowMs = Date.now()) {
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) {
    return ''
  }

  const deltaSeconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (deltaSeconds < 60) return 'just now'
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)} min ago`
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} h ago`
  return `${Math.floor(deltaSeconds / 86400)} d ago`
}

export function formatDuration(ms) {
  const seconds = Math.round((ms ?? 0) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// Replaces the visible fields of a root entry with those of its latest retry
// attempt while leaving audio metadata (owned by the root) untouched.
export function projectLatestAttempt(entry, latest = null) {
  if (!latest) return entry

  const projected = {
    ...entry,
    status: latest.status,
    transcribe: latest.transcribe
  }

  if (Object.hasOwn(latest, 'text')) projected.text = latest.text
  else delete projected.text
  if (latest.refine) projected.refine = latest.refine
  else delete projected.refine
  return projected
}

export function extractText(entry) {
  return String(entry?.text ?? '')
}

// Collapsed single-line preview for the menu; error entries surface the
// stable failure presentation instead of raw provider detail.
export function previewText(entry) {
  const text = extractText(entry).replace(/\s+/g, ' ').trim()
  if (!text && entry?.status === 'error') {
    const error = entry.refine?.error ?? entry.transcribe?.error
    if (error) return presentFailure({ category: error.code, message: error.message })?.summary ?? '(no text)'
  }
  if (!text) return '(no text)'
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
}

// Newest-first pagination over stored entries. Retry attempts decorate their
// root with the latest attempt's result; pagination keys on root ids.
function listEntries(entries, { limit, beforeId = null }) {
  const latestRetries = new Map()
  const listed = []
  let collecting = !beforeId
  let foundBefore = !beforeId

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry.retryOf) {
      if (!latestRetries.has(entry.retryOf)) {
        latestRetries.set(entry.retryOf, entry)
      }
      continue
    }

    const latest = latestRetries.get(entry.id) ?? null
    latestRetries.delete(entry.id)

    if (!collecting) {
      if (entry.id === beforeId) {
        collecting = true
        foundBefore = true
      }
      continue
    }

    listed.push(projectLatestAttempt(entry, latest))
    if (listed.length >= limit) {
      break
    }
  }

  // A beforeId that no longer exists means the page it anchored is gone.
  return beforeId && !foundBefore ? [] : listed
}

function withoutAudioFile(entry) {
  const audio = { ...(entry.audio ?? {}) }
  delete audio.file
  return { ...entry, audio }
}
