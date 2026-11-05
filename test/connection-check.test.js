// Connection test behavior: provider-level diagnostics resolve the same
// configuration as a real attempt but call only the selected Processor.

import GLib from 'gi://GLib'

import { runConnectionTest } from '../host/config.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

// Minimal double standing in for a registered Provider: manifest, pure
// resolution, and a Processor that records its calls.
class FakeProvider {
  constructor({ id, input, reply = { text: 'ok' } }) {
    this.id = id
    this.manifest = {
      label: id,
      fields: [
        { key: 'endpoint', type: 'url', label: 'Endpoint', default: 'https://example.test' },
        { key: 'key', type: 'secret', label: 'API key' }
      ],
      selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
      support: { inputs: [input], instructions: input === 'text' },
      defaults: { [input]: {} }
    }
    this.input = input
    this._reply = reply
    this.calls = []
  }

  resolve({ providerValues, values, secretPresence }) {
    const issues = []
    if (!secretPresence.key) {
      issues.push({ message: `a ${this.id} key is required` })
    }
    if (!values.model) {
      issues.push({ message: 'a model is required' })
    }
    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint: providerValues.endpoint ?? 'https://example.test', model: values.model },
      capabilities: {
        inputs: [this.input],
        instructions: this.input === 'text',
        context: true
      },
      issues: []
    }
  }

  supports(input, { instructions = false } = {}) {
    return Boolean(this.manifest.support.inputs.includes(input) && (!instructions || this.manifest.support.instructions))
  }

  create() {
    return {
      process: call => {
        this.calls.push(call)
        return { ...this._reply }
      }
    }
  }
}

function freshProviders() {
  return new Map([
    ['primary-audio', new FakeProvider({ id: 'primary-audio', input: 'audio' })],
    ['refine-text', new FakeProvider({ id: 'refine-text', input: 'text' })]
  ])
}

class FakeSettings {
  constructor(config) {
    this._config = config
  }

  get_string(key) {
    if (key === 'processing-config') {
      return JSON.stringify(this._config)
    }
    if (key === 'context') {
      return ''
    }
    throw new Error(`unexpected key ${key}`)
  }

  get_value(key) {
    if (key !== 'provider-secrets') {
      throw new Error(`unexpected key ${key}`)
    }
    return {
      deep_unpack: () => ({
        'providers/primary-audio/key': 'k1',
        'providers/refine-text/key': 'k2'
      })
    }
  }
}

function baseConfig({ refineEnabled = true } = {}) {
  return {
    providers: {},
    primary: { provider: 'primary-audio', values: { model: 'asr-1' } },
    refine: {
      enabled: refineEnabled,
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
    settings: new FakeSettings(baseConfig()),
    providers,
    role: 'primary'
  })

  expectEqual(providers.get('primary-audio').calls.length, 1)
  expectEqual(providers.get('refine-text').calls.length, 0)
  expectEqual(providers.get('primary-audio').calls[0].input.kind, 'audio')
})

test('primary connection test sends a decodable PCM WAV header', async () => {
  const providers = freshProviders()
  await runConnectionTest({
    settings: new FakeSettings(baseConfig()),
    providers,
    role: 'primary'
  })

  const input = providers.get('primary-audio').calls[0].input
  const wav = GLib.base64_decode(input.base64)
  const ascii = (offset, length) => String.fromCharCode(...wav.slice(offset, offset + length))
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

  expectEqual(input.mimeType, 'audio/wav')
  expectEqual(input.durationMs, 250)
  expectEqual(ascii(0, 4), 'RIFF')
  expectEqual(ascii(8, 4), 'WAVE')
  expectEqual(ascii(12, 4), 'fmt ')
  expectEqual(ascii(36, 4), 'data')
  expectEqual(view.getUint32(4, true), wav.length - 8)
  expectEqual(view.getUint32(16, true), 16)
  expectEqual(view.getUint16(20, true), 1)
  expectEqual(view.getUint16(22, true), 1)
  expectEqual(view.getUint32(24, true), 16000)
  expectEqual(view.getUint32(28, true), 32000)
  expectEqual(view.getUint16(32, true), 2)
  expectEqual(view.getUint16(34, true), 16)
  expectEqual(view.getUint32(40, true), wav.length - 44)
  expectEqual(wav.length, 8044)
  expectTruthy(wav.slice(44).every(byte => byte === 0))
})

test('refine test sends fixed text to the refine processor only', async () => {
  const providers = freshProviders()
  await runConnectionTest({
    settings: new FakeSettings(baseConfig()),
    providers,
    role: 'refine'
  })

  expectEqual(providers.get('primary-audio').calls.length, 0)
  expectEqual(providers.get('refine-text').calls.length, 1)
  expectEqual(providers.get('refine-text').calls[0].input.kind, 'text')
  expectEqual(providers.get('refine-text').calls[0].instructions, 'Tidy up the text.')
})

test('refine test refuses to run while refine is disabled', async () => {
  let threw = null
  try {
    await runConnectionTest({
      settings: new FakeSettings(baseConfig({ refineEnabled: false })),
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
      settings: new FakeSettings(config),
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
      settings: new FakeSettings(config),
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
      settings: new FakeSettings(baseConfig()),
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
