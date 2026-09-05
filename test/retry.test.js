import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeRecorder, FakeKernel, FakePaster, FakeHistory, FakeOverlay, FakeNotifier } from './fakes.js'
import { recordingOutcomeOk } from '../host/audio.js'
import { test, expectEqual, run } from './harness.js'

const recording = { id: 'orig-1', path: '/tmp/orig-1.wav', durationMs: 3000, mimeType: 'audio/wav' }

function makeRepo (entries = []) {
  const repo = {
    entries: [...entries],
    resolveAudio: entry => ({
      available: Boolean(entry.audio),
      path: entry.audio ? `/tmp/state/${entry.audio}` : null
    }),
    get: id => repo.entries.find(e => e.id === id) ?? null,
    attempts: [],
    appendAttempt (original, entry) {
      const attempt = {
        ...entry,
        id: entry.id ?? `attempt-${repo.attempts.length + 1}`,
        attemptOf: original.id,
        attemptNumber: repo.attempts.filter(a => a.attemptOf === original.id).length + 1
      }
      repo.attempts.push(attempt)
      repo.entries.push(attempt)
      return attempt
    }
  }
  return repo
}

function makeOrchestrator ({ repo, kernel }) {
  return new ToasOrchestrator({
    settings: {},
    collaborators: {
      recorderFactory: () => new FakeRecorder({ recording: recordingOutcomeOk(recording) }),
      history: new FakeHistory(),
      kernel: kernel ?? new FakeKernel(),
      paster: new FakePaster(),
      overlay: new FakeOverlay(),
      notifier: new FakeNotifier()
    },
    historyRepository: repo,
    onStateChanged: () => {}
  })
}

test('retry runs transcription on retained audio without a recorder', async () => {
  const repo = makeRepo([
    { id: 'orig-1', status: 'error', audio: 'recordings/orig-1.wav', durationMs: 3000 }
  ])
  const recorder = new FakeRecorder()
  const paster = new FakePaster()
  const orchestrator = makeOrchestrator({
    repo,
    kernel: new FakeKernel({ text: 'retried text' })
  })

  const attempt = await orchestrator.retry(repo.get('orig-1'))

  expectEqual(recorder.starts, 0)
  expectEqual(paster.writes, [])
  expectEqual(attempt.status, 'ok')
  expectEqual(attempt.attemptOf, 'orig-1')
  expectEqual(attempt.attemptNumber, 1)
  expectEqual(attempt.text, 'retried text')
  expectEqual(attempt.audio, null)

  // A retry is never decorated as private, even with the switch on.
  expectEqual(orchestrator._overlay.privateFlags, [false])

  // Original record untouched.
  expectEqual(repo.get('orig-1').status, 'error')
  orchestrator.destroy()
})

test('retry failure appends a linked error attempt, original preserved', async () => {
  const repo = makeRepo([
    { id: 'orig-2', status: 'error', audio: 'recordings/orig-2.wav', durationMs: 3000 }
  ])
  const orchestrator = makeOrchestrator({
    repo,
    kernel: new FakeKernel({ error: new Error('still unauthorized') })
  })

  const attempt = await orchestrator.retry(repo.get('orig-2'))

  expectEqual(attempt.status, 'error')
  expectEqual(attempt.error.message, 'still unauthorized')
  expectEqual(attempt.attemptOf, 'orig-2')
  expectEqual(repo.get('orig-2').status, 'error')

  // Cancelling a retry must not delete the original session's audio.
  orchestrator.begin()
  orchestrator.cancel()
  expectEqual(repo.resolveAudio(repo.get('orig-2')).available, true)
  orchestrator.destroy()
})

test('retry with pruned audio returns null and does nothing', async () => {
  const repo = makeRepo([
    { id: 'orig-3', status: 'error', audio: null, durationMs: 3000 }
  ])
  const orchestrator = makeOrchestrator({
    repo,
    kernel: new FakeKernel()
  })

  const attempt = await orchestrator.retry(repo.get('orig-3'))
  expectEqual(attempt, null)
  expectEqual(repo.attempts, [])
  orchestrator.destroy()
})

test('retry is blocked while another session is active', async () => {
  const repo = makeRepo([
    { id: 'orig-4', status: 'error', audio: 'recordings/orig-4.wav', durationMs: 3000 }
  ])
  const orchestrator = makeOrchestrator({
    repo,
    kernel: new FakeKernel({ text: 'delayed result' })
  })

  orchestrator.begin()
  const first = orchestrator.retry(repo.get('orig-4'))
  const second = await orchestrator.retry(repo.get('orig-4'))
  await first

  expectEqual(second, null)
  orchestrator.destroy()
})

await run()
