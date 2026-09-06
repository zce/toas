import GLib from 'gi://GLib'

import { HistoryStore } from '../host/history.js'
import { test, expectEqual, run } from './harness.js'

const tmpRoot = GLib.dir_make_tmp('toas-history-test-XXXXXX')
GLib.setenv('XDG_STATE_HOME', tmpRoot, true)

class FakeSettings {
  constructor ({ historyLimit = 30, recordingLimit = 20 } = {}) {
    this.values = {
      'history-limit': historyLimit,
      'recording-limit': recordingLimit
    }
    this.handlers = new Map()
    this.nextId = 1
  }

  get_uint (key) { return this.values[key] }
  connect (_signal, callback) {
    const id = this.nextId++
    this.handlers.set(id, callback)
    return id
  }
  disconnect (id) { this.handlers.delete(id) }
}

function makeStore (entries = [], options = {}) {
  const store = new HistoryStore(new FakeSettings(options))
  store.clear()
  for (const entry of entries) { store.append(entry) }
  return store
}

test('list returns newest logical voice inputs and skips malformed lines on load', () => {
  const store = makeStore([
    { id: 'a', time: '2026-01-01', status: 'ok' },
    { id: 'b', time: '2026-01-02', status: 'error' }
  ])
  const path = GLib.build_filenamev([store.stateDirectory, 'history.jsonl'])
  const [, bytes] = GLib.file_get_contents(path)
  GLib.file_set_contents(path, new TextDecoder().decode(bytes) + '{broken json\n')
  store.destroy()

  const reloaded = new HistoryStore(new FakeSettings())
  expectEqual(reloaded.list().map(entry => entry.id), ['b', 'a'])
  reloaded.clear()
  reloaded.destroy()
})

test('recent first-page reads reuse the projection produced by pruning', () => {
  const store = makeStore([
    { id: 'a', time: '1', status: 'ok' },
    { id: 'b', time: '2', status: 'ok' }
  ])
  let reads = 0
  const readEntries = store.readEntries.bind(store)
  store.readEntries = () => {
    reads++
    return readEntries()
  }

  expectEqual(store.list().map(entry => entry.id), ['b', 'a'])
  expectEqual(store.list({ limit: 1 }).map(entry => entry.id), ['b'])
  expectEqual(reads, 0)
  store.destroy()
})

test('list pagination uses root voice input ids', () => {
  const store = makeStore(
    ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, time: String(i), status: 'ok' }))
  )

  expectEqual(store.list({ limit: 2 }).map(entry => entry.id), ['e', 'd'])
  expectEqual(store.list({ limit: 2, beforeId: 'd' }).map(entry => entry.id), ['c', 'b'])
  expectEqual(store.list({ limit: 2, beforeId: 'b' }).map(entry => entry.id), ['a'])
  expectEqual(store.list({ limit: 2, beforeId: 'a' }), [])
  store.destroy()
})

test('appendAttempt links retries without persisted sequence metadata', () => {
  const original = { id: 'orig', time: '2026-01-01', status: 'error' }
  const store = makeStore([original])

  const first = store.appendAttempt(original, { time: '2026-01-02', status: 'error' })
  const second = store.appendAttempt(original, { time: '2026-01-03', status: 'ok', text: 'retried text' })

  expectEqual(first.retryOf, 'orig')
  expectEqual(second.retryOf, 'orig')
  expectEqual(Object.hasOwn(first, 'attemptNumber'), false)
  expectEqual(Object.hasOwn(second, 'attemptNumber'), false)
  expectEqual(store.readEntries().find(entry => entry.id === 'orig').status, 'error')

  const listed = store.list()
  expectEqual(listed.length, 1)
  expectEqual(listed[0].id, 'orig')
  expectEqual(listed[0].status, 'ok')
  expectEqual(listed[0].text, 'retried text')
  store.destroy()
})

test('retry attempts do not consume logical history retention slots', () => {
  const store = makeStore([], { historyLimit: 2 })
  const a = { id: 'a', time: '1', status: 'error' }
  const b = { id: 'b', time: '2', status: 'ok' }
  store.append(a)
  store.append(b)
  store.appendAttempt(a, { time: '3', status: 'error' })
  store.appendAttempt(a, { time: '4', status: 'ok', text: 'a retry' })
  store.append({ id: 'c', time: '5', status: 'ok' })

  expectEqual(store.list().map(entry => entry.id), ['c', 'b'])
  expectEqual(store.readEntries().some(entry => entry.id === 'a' || entry.retryOf === 'a'), false)
  store.destroy()
})

test('resolveAudio uses the fixed recordings directory plus basename only', () => {
  const store = makeStore([])
  const wavPath = GLib.build_filenamev([store.recordingsDirectory, 'kept.wav'])
  GLib.file_set_contents(wavPath, 'fake-audio')

  const present = store.resolveAudio({ audio: { file: 'kept.wav' } })
  expectEqual(present.available, true)
  expectEqual(present.path, wavPath)
  expectEqual(store.resolveAudio({ audio: { file: 'gone.wav' } }).available, false)
  expectEqual(store.resolveAudio({ audio: {} }).available, false)
  store.destroy()
})

test('clear reports logical voice inputs rather than raw retry records', () => {
  const original = { id: 'orig', time: '1', status: 'error' }
  const store = makeStore([original, { id: 'other', time: '2', status: 'ok' }])
  store.appendAttempt(original, { time: '3', status: 'ok' })

  expectEqual(store.clear(), 2)
  expectEqual(store.readEntries(), [])
  store.destroy()
})

await run()
