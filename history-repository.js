// History repository: bounded, safe queries over the session JSONL plus
// linked retry attempts. Pure GLib, no Shell imports.
//
// Design notes:
// - list() reads the file once, returns newest first, skips malformed lines.
// - Attempts are appended (never rewritten) with attemptOf linking to the
//   original session id; the original record is immutable.
// - Audio resolution checks file existence without reading contents.

import GLib from 'gi://GLib'

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
