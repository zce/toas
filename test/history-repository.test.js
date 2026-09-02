import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import { HistoryStore } from '../lib/history.js'
import { HistoryRepository } from '../lib/history-repository.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const tmpRoot = GLib.dir_make_tmp('toas-hist-test-XXXXXX')

function makeStore (entries = []) {
  const stateDir = GLib.build_filenamev([tmpRoot, GLib.uuid_string_random()])
  GLib.mkdir_with_parents(GLib.build_filenamev([stateDir, 'recordings']), 0o700)
  const store = new HistoryStoreStub(stateDir)
  for (const entry of entries) { store.append(entry) }
  return store
}

// HistoryStore binds to GSettings for prune limits; for repository tests a
// minimal stub with the same read/append surface keeps things focused.
class HistoryStoreStub {
  constructor (stateDirectory) {
    this.stateDirectory = stateDirectory
    this.recordingsDirectory = GLib.build_filenamev([stateDirectory, 'recordings'])
    this._historyPath = GLib.build_filenamev([stateDirectory, 'history.jsonl'])
  }

  readEntries () {
    if (!GLib.file_test(this._historyPath, GLib.FileTest.EXISTS)) { return [] }
    const [, bytes] = GLib.file_get_contents(this._historyPath)
    return new TextDecoder().decode(bytes)
      .split('\n').filter(Boolean)
      .flatMap(line => {
        try { return [JSON.parse(line)] } catch { return [] }
      })
  }

  append (entry) {
    const line = new TextEncoder().encode(`${JSON.stringify(entry)}\n`)
    const file = Gio.File.new_for_path(this._historyPath)
    const stream = file.append_to(Gio.FileCreateFlags.PRIVATE, null)
    try { stream.write_all(line, null) } finally { stream.close(null) }
  }

  discardRecording () {}
  clear () { return this.readEntries().length }
  destroy () {}
}

test('list returns newest first and skips malformed lines', () => {
  const store = makeStore([
    { id: 'a', createdAt: '2026-01-01', status: 'ok' },
    { id: 'b', createdAt: '2026-01-02', status: 'error' }
  ])
  // Corrupt the file with a malformed line.
  const path = GLib.build_filenamev([store.stateDirectory, 'history.jsonl'])
  const [, bytes] = GLib.file_get_contents(path)
  const corrupted = new TextDecoder().decode(bytes) + '{broken json\n'
  GLib.file_set_contents(path, corrupted)

  const repo = new HistoryRepository(store)
  const listed = repo.list()

  expectEqual(listed.map(e => e.id), ['b', 'a'])
})

test('list pagination via beforeId', () => {
  const store = makeStore(
    ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, createdAt: String(i), status: 'ok' }))
  )
  const repo = new HistoryRepository(store)

  const firstPage = repo.list({ limit: 2 })
  expectEqual(firstPage.map(e => e.id), ['e', 'd'])

  const secondPage = repo.list({ limit: 2, beforeId: 'd' })
  expectEqual(secondPage.map(e => e.id), ['c', 'b'])

  const lastPage = repo.list({ limit: 2, beforeId: 'b' })
  expectEqual(lastPage.map(e => e.id), ['a'])

  const afterEnd = repo.list({ limit: 2, beforeId: 'a' })
  expectEqual(afterEnd, [])
})

test('get finds by id, returns null when missing', () => {
  const store = makeStore([{ id: 'x', status: 'ok' }])
  const repo = new HistoryRepository(store)

  expectEqual(repo.get('x').id, 'x')
  expectEqual(repo.get('missing'), null)
})

test('appendAttempt links and numbers attempts without touching the original', () => {
  const original = { id: 'orig', status: 'error', transcript: null }
  const store = makeStore([original])
  const repo = new HistoryRepository(store)

  const first = repo.appendAttempt(original, { status: 'ok', output: 'hello' })
  expectEqual(first.attemptOf, 'orig')
  expectEqual(first.attemptNumber, 1)
  expectTruthy(first.id)

  const second = repo.appendAttempt(original, { status: 'error' })
  expectEqual(second.attemptNumber, 2)

  expectEqual(repo.get('orig').status, 'error')
  expectEqual(repo.attemptsOf('orig').length, 2)
})

test('attempts are excluded from list()', () => {
  const original = { id: 'orig', status: 'error' }
  const store = makeStore([original, { id: 'other', status: 'ok' }])
  const repo = new HistoryRepository(store)
  repo.appendAttempt(original, { status: 'ok' })

  expectEqual(repo.list().map(e => e.id), ['other', 'orig'])
})

test('resolveAudio checks existence without reading bytes', () => {
  const store = makeStore([])
  const wavPath = GLib.build_filenamev([store.recordingsDirectory, 'kept.wav'])
  GLib.file_set_contents(wavPath, 'fake-audio')

  const repo = new HistoryRepository(store)
  const present = repo.resolveAudio({ audio: 'recordings/kept.wav' })
  expectEqual(present.available, true)
  expectEqual(present.path, wavPath)

  const missing = repo.resolveAudio({ audio: 'recordings/gone.wav' })
  expectEqual(missing.available, false)

  const noRef = repo.resolveAudio({ audio: null })
  expectEqual(noRef.available, false)
})

await run()