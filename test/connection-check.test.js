// Connection test behavior: the test is Provider-level diagnostics. It
// resolves the real role config through the Kernel's resolution pipeline
// and calls the Provider's Processor directly — the refine probe must never
// route through the primary-first pipeline. Headless: fake providers, no
// network, no real settings.

import { test, expectEqual, expectTruthy, run } from './harness.js'
import { runConnectionTest } from '../host/config.js'

// The fake provider records the process() calls it receives so tests assert
// on the exact inputs each role sends. Fresh instances per test.
class FakeProvider {
  constructor ({ id, input, reply = { text: 'ok' } }) {
    this.id = id
    this.manifest = {
      label: id,
      fields: [
        { key: 'endpoint', type: 'url', label: 'Endpoint', default: 'https://example.test' },
        { key: 'key', type: 'secret', label: 'API key' }
      ],
      selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
      support: { inputs: [input], instructions: input === 'text' }
    }
    this.input = input
    this._reply = reply
    this.calls = []
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []
    if (!secretPresence.key) { issues.push({ message: `a ${this.id} key is required` }) }
    if (!values.model) { issues.push({ message: 'a model is required' }) }
    if (issues.length > 0) { return { config: null, capabilities: null, issues } }

    return {
      config: { endpoint: providerValues.endpoint ?? 'https://example.test', model: values.model },
      capabilities: {
        inputs: [this.input],
        instructions: this.input === 'text',
        context: true,
        integratedRefine: false
      },
      issues: []
    }
  }

  create (config, secrets, runtime) {
    const provider = this
    return {
      async process (call) {
        provider.calls.push(call)
        return { ...provider._reply }
      }
    }
  }
}

function freshProviders () {
  return new Map([
    ['primary-audio', new FakeProvider({ id: 'primary-audio', input: 'audio' })],
    ['refine-text', new FakeProvider({ id: 'refine-text', input: 'text' })]
  ])
}

class FakeConfigService {
  constructor (config) {
    this._config = config
  }

  snapshotConfig () { return this._config }

  snapshotSecrets () {
    return { 'providers/primary-audio/key': 'k1', 'providers/refine-text/key': 'k2' }
  }
}

function baseConfig ({ refineEnabled = true } = {}) {
  return {
    providers: {},
    primary: { provider: 'primary-audio', values: { model: 'asr-1' } },
    refine: {
      enabled: refineEnabled,
      execution: 'separate',
      provider: 'refine-text',
      values: { model: 'refine-1' },
      instructions: 'Tidy up the text.',
      onError: 'fallback'
    }
  }
}

test('primary test sends silent audio to the primary processor only', async () => {
  const providers = freshProviders()
  await runConnectionTest({
    configService: new FakeConfigService(baseConfig()),
    providers,
    role: 'primary'
  })

  expectEqual(providers.get('primary-audio').calls.length, 1)
  expectEqual(providers.get('refine-text').calls.length, 0)
  expectEqual(providers.get('primary-audio').calls[0].input.kind, 'audio')
})

test('refine test sends fixed text to the refine processor only', async () => {
  const providers = freshProviders()
  await runConnectionTest({
    configService: new FakeConfigService(baseConfig()),
    providers,
    role: 'refine'
  })

  // The heart of the fix: the refine probe reaches the refine Processor
  // directly and never touches the primary.
  expectEqual(providers.get('primary-audio').calls.length, 0)
  expectEqual(providers.get('refine-text').calls.length, 1)
  expectEqual(providers.get('refine-text').calls[0].input.kind, 'text')
  expectEqual(providers.get('refine-text').calls[0].instructions, 'Tidy up the text.')
})

test('refine test refuses to run while refine is disabled', async () => {
  let threw = null
  try {
    await runConnectionTest({
      configService: new FakeConfigService(baseConfig({ refineEnabled: false })),
      providers: freshProviders(),
      role: 'refine'
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'configuration')
})

test('no-text from silent audio counts as a successful round trip', async () => {
  const silent = new FakeProvider({
    id: 'primary-audio',
    input: 'audio',
    reply: { text: '' }
  })
  const config = {
    primary: { provider: 'primary-audio', values: { model: 'asr-1' } },
    refine: { enabled: false }
  }

  let threw = null
  try {
    await runConnectionTest({
      configService: new FakeConfigService(config),
      providers: new Map([['primary-audio', silent]]),
      role: 'primary'
    })
  } catch (error) {
    threw = error
  }

  expectEqual(threw, null)
  expectEqual(silent.calls.length, 1)
})

test('configuration issues surface as errors, not fake success', async () => {
  const config = baseConfig()
  config.refine.values.model = ''
  let threw = null
  try {
    await runConnectionTest({
      configService: new FakeConfigService(config),
      providers: freshProviders(),
      role: 'refine'
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'configuration')
})

test('unknown roles are rejected', async () => {
  let threw = null
  try {
    await runConnectionTest({
      configService: new FakeConfigService(baseConfig()),
      providers: freshProviders(),
      role: 'unknown'
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'configuration')
})

await run()
