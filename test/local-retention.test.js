import GLib from 'gi://GLib'

import { recordingOutcomeOk } from '../host/audio.js'
import { HistoryRepository, HistoryStore } from '../host/history.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import { PrivacyPreference } from '../host/privacy.js'
import { FakeHistory, FakeKernel, FakeNotifier, FakeOverlay, FakePaster, FakeRecorder } from './fakes.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const tmpRoot = GLib.dir_make_tmp('toas-retention-test-XXXXXX')
GLib.setenv('XDG_STATE_HOME', tmpRoot, true)

class FakeSettings {
  constructor (values = {}) {
    this.values = {
      'private-mode': false,
      'history-limit': 30,
      'recording-limit': 20,
      ...values
    }
    this.handlers = new Map()
    this.nextHandlerId = 1
  }

  get_boolean (key) { return Boolean(this.values[key]) }
  get_uint (key) { return Number(this.values[key] ?? 0) }
  get_enum () { return 2 }

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
      if (signal === 'changed') { callback(this, key) }
      if (signal === `changed::${key}`) { callback(this, key) }
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

function makeStoredSession ({
  recordingLimit = 20,
  privateMode = false,
  kernelError = null
} = {}) {
  const settings = new FakeSettings({
    'recording-limit': recordingLimit,
    'private-mode': privateMode
  })
  const history = new HistoryStore(settings)
  history.clear()
  const repository = new HistoryRepository(history)
  const privacy = new PrivacyPreference(settings)
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
  const recorder = new FakeRecorder({ recording: recordingOutcomeOk(recording) })
  const kernel = new FakeKernel({ error: kernelError })
  const orchestrator = new ToasOrchestrator({
    settings,
    historyRepository: repository,
    collaborators: {
      recorderFactory: () => recorder,
      history,
      kernel,
      paster: new FakePaster(),
      overlay: new FakeOverlay(),
      notifier: new FakeNotifier(),
      privacy
    }
  })

  return {
    settings,
    history,
    repository,
    privacy,
    recording,
    orchestrator,
    destroy: () => {
      orchestrator.destroy()
      history.clear()
      history.destroy()
    }
  }
}

test('private mode is a durable settings-backed preference', () => {
  const settings = new FakeSettings()

  expectEqual(new PrivacyPreference(settings).enabled, false)

  const firstRuntime = new PrivacyPreference(settings)
  firstRuntime.enabled = true
  expectEqual(new PrivacyPreference(settings).enabled, true)

  const restartedRuntime = new PrivacyPreference(settings)
  restartedRuntime.enabled = false
  expectEqual(new PrivacyPreference(settings).enabled, false)
})

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

test('explicit larger history retention remains a valid user preference', () => {
  const settings = new FakeSettings({ 'history-limit': 100 })
  expectEqual(settings.get_uint('history-limit'), 100)
})

test('saved recordings zero keeps successful text history but removes audio', async () => {
  const session = makeStoredSession({ recordingLimit: 0 })

  session.orchestrator.begin()
  await session.orchestrator.end()

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectEqual(entries[0].status, 'ok')
  expectEqual(entries[0].text, 'hello')
  expectEqual(entries[0].audio, null)
  expectEqual(fileExists(session.recording.path), false)
  expectEqual(session.repository.resolveAudio(entries[0]).available, false)

  session.destroy()
})

test('saved recordings zero keeps failure history but removes audio', async () => {
  const session = makeStoredSession({
    recordingLimit: 0,
    kernelError: new Error('provider down')
  })

  session.orchestrator.begin()
  await session.orchestrator.end()

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectEqual(entries[0].status, 'error')
  expectEqual(entries[0].audio, null)
  expectEqual(fileExists(session.recording.path), false)
  expectEqual(session.repository.resolveAudio(entries[0]).available, false)

  session.destroy()
})

test('retained failed recording remains available for retry', async () => {
  const session = makeStoredSession({
    recordingLimit: 20,
    kernelError: new Error('provider down')
  })

  session.orchestrator.begin()
  await session.orchestrator.end()

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectTruthy(entries[0].audio)
  expectEqual(fileExists(session.recording.path), true)
  expectEqual(session.repository.resolveAudio(entries[0]).available, true)

  session.destroy()
})

test('changing saved recordings to zero prunes retained audio without dropping text', async () => {
  const session = makeStoredSession({ recordingLimit: 20 })

  session.orchestrator.begin()
  await session.orchestrator.end()
  expectEqual(fileExists(session.recording.path), true)

  session.settings.set_uint('recording-limit', 0)

  const entries = session.history.readEntries()
  expectEqual(entries.length, 1)
  expectEqual(entries[0].text, 'hello')
  expectEqual(entries[0].audio, null)
  expectEqual(fileExists(session.recording.path), false)

  session.destroy()
})

test('private mode overrides recording retention and leaves no history', async () => {
  const session = makeStoredSession({ recordingLimit: 20, privateMode: true })

  session.orchestrator.begin()
  await session.orchestrator.end()

  expectEqual(session.history.readEntries(), [])
  expectEqual(fileExists(session.recording.path), false)

  session.destroy()
})

test('settings-backed privacy still snapshots each run', async () => {
  const recording = {
    id: 'snapshot-recording',
    path: '/tmp/snapshot-recording.wav',
    durationMs: 3000,
    mimeType: 'audio/wav'
  }
  const settings = new FakeSettings({ 'private-mode': false })
  const privacy = new PrivacyPreference(settings)
  const history = new FakeHistory()
  const orchestrator = new ToasOrchestrator({
    settings,
    collaborators: {
      recorderFactory: () => new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
      history,
      kernel: new FakeKernel(),
      paster: new FakePaster(),
      overlay: new FakeOverlay(),
      notifier: new FakeNotifier(),
      privacy
    }
  })

  orchestrator.begin()
  privacy.enabled = true
  await orchestrator.end()

  expectEqual(history.appends.length, 1)
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

await run()
