import GLib from 'gi://GLib'

import { HistoryStore } from '../host/history.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

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

test('list returns newest logical voice inputs and skips malformed lines', () => {
  const store = makeStore([
    { id: 'a', createdAt: '2026-01-01', status: 'ok' },
    { id: 'b', createdAt: '2026-01-02', status: 'error' }
  ])
  const path = GLib.build_filenamev([store.stateDirectory, 'history.jsonl'])
  const [, bytes] = GLib.file_get_contents(path)
  GLib.file_set_contents(path, new TextDecoder().decode(bytes) + '{broken json\n')

  expectEqual(store.list().map(entry => entry.id), ['b', 'a'])
  store.destroy()
})

test('list pagination uses root voice input ids', () => {
  const store = makeStore(
    ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, createdAt: String(i), status: 'ok' }))
  )

  expectEqual(store.list({ limit: 2 }).map(entry => entry.id), ['e', 'd'])
  expectEqual(store.list({ limit: 2, beforeId: 'd' }).map(entry => entry.id), ['c', 'b'])
  expectEqual(store.list({ limit: 2, beforeId: 'b' }).map(entry => entry.id), ['a'])
  expectEqual(store.list({ limit: 2, beforeId: 'a' }), [])
  store.destroy()
})

test('appendAttempt numbers attempts and list projects the latest result in one snapshot', () => {
  const original = { id: 'orig', createdAt: '2026-01-01', status: 'error', text: null }
  const store = makeStore([original])

  const first = store.appendAttempt(original, { status: 'error', text: null })
  const second = store.appendAttempt(original, { status: 'ok', text: 'retried text' })

  expectEqual(first.attemptNumber, 1)
  expectEqual(second.attemptNumber, 2)
  expectEqual(second.attemptOf, 'orig')
  expectEqual(store.readEntries().find(entry => entry.id === 'orig').status, 'error')

  const listed = store.list()
  expectEqual(listed.length, 1)
  expectEqual(listed[0].id, 'orig')
  expectEqual(listed[0].status, 'ok')
  expectEqual(listed[0].text, 'retried text')
  expectEqual(listed[0].attemptNumber, 2)
  store.destroy()
})

test('retry attempts do not consume logical history retention slots', () => {
  const store = makeStore([], { historyLimit: 2 })
  const a = { id: 'a', createdAt: '1', status: 'error' }
  const b = { id: 'b', createdAt: '2', status: 'ok' }
  store.append(a)
  store.append(b)
  store.appendAttempt(a, { status: 'error' })
  store.appendAttempt(a, { status: 'ok', text: 'a retry' })
  store.append({ id: 'c', createdAt: '3', status: 'ok' })

  expectEqual(store.list().map(entry => entry.id), ['c', 'b'])
  expectEqual(store.readEntries().some(entry => entry.id === 'a' || entry.attemptOf === 'a'), false)
  store.destroy()
})

test('resolveAudio checks existence without reading bytes', () => {
  const store = makeStore([])
  const wavPath = GLib.build_filenamev([store.recordingsDirectory, 'kept.wav'])
  GLib.file_set_contents(wavPath, 'fake-audio')

  const present = store.resolveAudio({ audio: 'recordings/kept.wav' })
  expectEqual(present.available, true)
  expectEqual(present.path, wavPath)
  expectEqual(store.resolveAudio({ audio: 'recordings/gone.wav' }).available, false)
  expectEqual(store.resolveAudio({ audio: null }).available, false)
  store.destroy()
})

test('clear reports logical voice inputs rather than raw attempt records', () => {
  const original = { id: 'orig', createdAt: '1', status: 'error' }
  const store = makeStore([original, { id: 'other', createdAt: '2', status: 'ok' }])
  store.appendAttempt(original, { status: 'ok' })

  expectEqual(store.clear(), 2)
  expectEqual(store.readEntries(), [])
  store.destroy()
})

await run()
