import GLib from 'gi://GLib'

import { recordingOutcomeOk } from '../host/audio.js'
import { HistoryStore } from '../host/history.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeHistory, FakeKernel, FakeNotifier, FakeOverlay, FakePaster, FakeRecorder } from './fakes.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const tmpRoot = GLib.dir_make_tmp('toas-retention-test-XXXXXX')
GLib.setenv('XDG_STATE_HOME', tmpRoot, true)

class FakeSettings {
  constructor (values = {}) {
    this.values = {
      'private-mode': false,
      'auto-paste': true,
      'audio-quality': 'standard',
      'minimum-recording-duration': 600,
      'history-limit': 30,
      'recording-limit': 20,
      ...values
    }
    this.handlers = new Map()
    this.nextHandlerId = 1
  }

  get_boolean (key) { return Boolean(this.values[key]) }
  get_uint (key) { return Number(this.values[key] ?? 0) }
  get_string (key) { return String(this.values[key] ?? '') }

  set_boolean (key, value) {
    const next = Boolean(value)
    if (this.values[key] === next) { return false }
    this.values[key] = next
    this._emitChanged(key)
    return true
  }

  set_uint (key, value) {
    const next = Number(value)
    if (this.values[key] === next) { return false }
    this.values[key] = next
    this._emitChanged(key)
    return true
  }

  connect (signal, callback) {
    const id = this.nextHandlerId++
    this.handlers.set(id, { signal, callback })
    return id
  }

  disconnect (id) { this.handlers.delete(id) }

  _emitChanged (key) {
    for (const { signal, callback } of this.handlers.values()) {
      if (signal === 'changed' || signal === `changed::${key}`) { callback(this, key) }
    }
  }
}

function fileExists (path) {
  return GLib.file_test(path, GLib.FileTest.EXISTS)
}

function readText (path) {
  const [, bytes] = GLib.file_get_contents(path)
  return new TextDecoder().decode(bytes)
}

function schemaKey (source, name) {
  return source.match(new RegExp(`<key name="${name}"[^>]*>[\\s\\S]*?<\\/key>`))?.[0] ?? ''
}

function makeStoredSession ({ recordingLimit = 20, privateMode = false, kernelError = null } = {}) {
  const settings = new FakeSettings({
    'recording-limit': recordingLimit,
    'private-mode': privateMode
  })
  const history = new HistoryStore(settings)
  history.clear()
  const recordingPath = GLib.build_filenamev([
    history.recordingsDirectory,
    `${GLib.uuid_string_random()}.wav`
  ])
  GLib.file_set_contents(recordingPath, 'fake-audio')
  const recording = {
    id: GLib.uuid_string_random(),
    path: recordingPath,
    durationMs: 3000,
    mimeType: 'audio/wav',
    sampleRate: 16000
  }
  const orchestrator = new ToasOrchestrator({
    settings,
    history,
    kernel: new FakeKernel({ error: kernelError }),
    output: new FakePaster(),
    overlay: new FakeOverlay(),
    notifier: new FakeNotifier(),
    recorderFactory: () => new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  return {
    settings,
    history,
    recording,
    orchestrator,
    destroy: () => {
      orchestrator.destroy()
      history.clear()
      history.destroy()
    }
  }
}

test('settings schema defines persistent privacy and recent-history defaults', () => {
  const root = GLib.get_current_dir()
  const schema = readText(`${root}/schemas/org.gnome.shell.extensions.toas.gschema.xml`)
  const prefs = readText(`${root}/prefs.js`)

  const privateMode = schemaKey(schema, 'private-mode')
  expectTruthy(privateMode.includes('type="b"'))
  expectTruthy(privateMode.includes('<default>false</default>'))

  const historyLimit = schemaKey(schema, 'history-limit')
  expectTruthy(historyLimit.includes('<range min="1" max="1000"/>'))
  expectTruthy(historyLimit.includes('<default>30</default>'))

  const recordingLimit = schemaKey(schema, 'recording-limit')
  expectTruthy(recordingLimit.includes('<range min="0" max="1000"/>'))
  expectTruthy(recordingLimit.includes('<default>20</default>'))
  expectTruthy(prefs.includes("spinRow(settings, 'recording-limit', 'Saved recordings', 0, 1000)"))
})

test('saved recordings zero keeps successful text history but removes audio file', async () => {
  const session = makeStoredSession({ recordingLimit: 0 })
  session.orchestrator.begin()
  await session.orchestrator.end()

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectEqual(entries[0].status, 'ok')
  expectEqual(entries[0].text, 'hello')
  expectEqual(Object.hasOwn(entries[0].audio, 'file'), false)
  expectEqual(entries[0].audio.durationMs, 3000)
  expectEqual(entries[0].audio.sampleRate, 16000)
  expectEqual(fileExists(session.recording.path), false)
  expectEqual(session.history.resolveAudio(entries[0]).available, false)
  session.destroy()
})

test('saved recordings zero keeps failure history but removes audio file', async () => {
  const session = makeStoredSession({ recordingLimit: 0, kernelError: new Error('provider down') })
  session.orchestrator.begin()
  await session.orchestrator.end()

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectEqual(entries[0].status, 'error')
  expectEqual(Object.hasOwn(entries[0].audio, 'file'), false)
  expectEqual(fileExists(session.recording.path), false)
  session.destroy()
})

test('retained failed recording remains available for retry', async () => {
  const session = makeStoredSession({ recordingLimit: 20, kernelError: new Error('provider down') })
  session.orchestrator.begin()
  await session.orchestrator.end()

  const entry = session.history.readEntries()[0]
  expectTruthy(entry.audio.file)
  expectEqual(fileExists(session.recording.path), true)
  expectEqual(session.history.resolveAudio(entry).available, true)
  session.destroy()
})

test('changing saved recordings to zero prunes audio file without dropping metadata or text', async () => {
  const session = makeStoredSession({ recordingLimit: 20 })
  session.orchestrator.begin()
  await session.orchestrator.end()
  expectEqual(fileExists(session.recording.path), true)

  session.settings.set_uint('recording-limit', 0)

  const entry = session.history.readEntries()[0]
  expectEqual(entry.text, 'hello')
  expectEqual(Object.hasOwn(entry.audio, 'file'), false)
  expectEqual(entry.audio.durationMs, 3000)
  expectEqual(entry.audio.sampleRate, 16000)
  expectEqual(fileExists(session.recording.path), false)
  session.destroy()
})

test('private mode overrides all local retention', async () => {
  const session = makeStoredSession({ recordingLimit: 20, privateMode: true })
  session.orchestrator.begin()
  await session.orchestrator.end()

  expectEqual(session.history.readEntries(), [])
  expectEqual(fileExists(session.recording.path), false)
  session.destroy()
})

test('private mode is snapshotted at the start of each live voice input', async () => {
  const recording = {
    id: 'snapshot-recording',
    path: '/tmp/snapshot-recording.wav',
    durationMs: 3000,
    mimeType: 'audio/wav'
  }
  const settings = new FakeSettings({ 'private-mode': false })
  const history = new FakeHistory()
  const orchestrator = new ToasOrchestrator({
    settings,
    history,
    kernel: new FakeKernel(),
    output: new FakePaster(),
    overlay: new FakeOverlay(),
    notifier: new FakeNotifier(),
    recorderFactory: () => new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  })

  orchestrator.begin()
  settings.set_boolean('private-mode', true)
  await orchestrator.end()

  expectEqual(history.appends.length, 1)
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

await run()
