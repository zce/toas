import { ToasOrchestrator } from '../host/orchestrator.js'
import { FakeKernel, FakePaster, FakeHistory, FakeOverlay, FakeNotifier } from './fakes.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

function makeOrchestrator ({ history, kernel = new FakeKernel(), recorderFactory = () => { throw new Error('retry must not create a recorder') } }) {
  return new ToasOrchestrator({
    settings: { get_boolean: () => false },
    history,
    kernel,
    output: new FakePaster(),
    overlay: new FakeOverlay(),
    notifier: new FakeNotifier(),
    recorderFactory,
    onStateChanged: () => {}
  })
}

function original (id = 'orig-1', file = `${id}.wav`) {
  return {
    id,
    status: 'error',
    audio: file ? { file, durationMs: 3000, sampleRate: 16000 } : {},
    transcribe: { error: { code: 'no-text', message: 'No speech was recognized' } }
  }
}

function waitFor (predicate, timeoutMs = 2000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) { return resolve() }
      if (Date.now() - startedAt > timeoutMs) { return reject(new Error('waitFor timed out')) }
      setTimeout(check, 5)
    }
    check()
  })
}

test('retry processes retained audio and appends an attempt without recording or output', async () => {
  const history = new FakeHistory()
  const entry = original()
  history.entries.push(entry)
  const kernel = new FakeKernel({ text: 'retried text' })
  const orchestrator = makeOrchestrator({ history, kernel })

  const attempt = await orchestrator.retry(entry)

  expectEqual(kernel.calls.length, 1)
  expectEqual(attempt.status, 'ok')
  expectEqual(attempt.retryOf, entry.id)
  expectEqual(attempt.text, 'retried text')
  expectEqual(Object.hasOwn(attempt, 'audio'), false)
  expectEqual(Object.hasOwn(attempt, 'attemptNumber'), false)
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

test('retry failure appends categorized stage error and preserves the original', async () => {
  const history = new FakeHistory()
  const entry = original('orig-2')
  history.entries.push(entry)
  const failure = Object.assign(new Error('DNS lookup detail'), { category: 'network' })
  const orchestrator = makeOrchestrator({ history, kernel: new FakeKernel({ error: failure }) })

  const attempt = await orchestrator.retry(entry)

  expectEqual(attempt.status, 'error')
  expectEqual(attempt.transcribe.error.code, 'network')
  expectEqual(attempt.transcribe.error.message, 'DNS lookup detail')
  expectEqual(attempt.retryOf, entry.id)
  expectEqual(history.get(entry.id), entry)
  expectEqual(history.discarded, [])
  orchestrator.destroy()
})

test('retry with pruned audio returns null and does nothing', async () => {
  const history = new FakeHistory()
  const entry = original('orig-3', null)
  history.entries.push(entry)
  const orchestrator = makeOrchestrator({ history })

  const attempt = await orchestrator.retry(entry)
  expectEqual(attempt, null)
  expectEqual(history.attempts, [])
  orchestrator.destroy()
})

test('retry is blocked while a live voice input is active', async () => {
  const history = new FakeHistory()
  const entry = original('orig-4')
  history.entries.push(entry)
  let recorderCreated = 0
  const orchestrator = makeOrchestrator({
    history,
    recorderFactory: () => {
      recorderCreated++
      return { start: async () => {}, cancel: () => {}, destroy: () => {} }
    }
  })

  orchestrator.begin()
  const attempt = await orchestrator.retry(entry)

  expectEqual(attempt, null)
  expectEqual(recorderCreated, 1)
  orchestrator.cancel()
  orchestrator.destroy()
})

test('destroy during retry aborts processing without deleting retained audio', async () => {
  const history = new FakeHistory()
  const entry = original('orig-destroy')
  history.entries.push(entry)
  const kernel = new FakeKernel({ delayMs: 100 })
  const orchestrator = makeOrchestrator({ history, kernel })

  const pending = orchestrator.retry(entry)
  await waitFor(() => kernel.receivedSignals.length > 0)
  const signal = kernel.receivedSignals[0]
  orchestrator.destroy()
  const attempt = await pending

  expectTruthy(signal.aborted)
  expectEqual(attempt, null)
  expectEqual(history.discarded, [])
})

await run()
