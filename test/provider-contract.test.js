// Provider contract and resolved-selection invariants. No network, no GNOME.

import { validateProvider } from '../lib/kernel/types.js'
import { providers as registry } from '../lib/kernel/providers/registry.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const PRESENT = { key: true }

test('every registered provider passes structural validation', () => {
  for (const [id, provider] of registry) {
    expectEqual(validateProvider(provider), [], `provider ${id} violated the contract`)
    expectEqual(provider.id, id)
  }
})

test('manifest support is discovery only and resolved capabilities are explicit', () => {
  const qwen = registry.get('qwen')
  expectEqual(qwen.manifest.support.inputs, ['audio'])
  const resolved = qwen.resolve({
    providerValues: { endpoint: '' },
    values: { model: 'fun-asr-flash-2026-06-15' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.capabilities, {
    inputs: ['audio'], instructions: false, context: true, integratedRefine: false
  })
})

test('MiMo selection determines audio or text behavior without a product role', () => {
  const mimo = registry.get('mimo')
  const resolve = model => mimo.resolve({
    providerValues: { endpoint: 'https://example.test/v1' },
    values: { model },
    secretPresence: PRESENT
  })
  expectEqual(resolve('mimo-v2.5-asr').capabilities.inputs, ['audio'])
  expectEqual(resolve('mimo-v2.5').capabilities.inputs, ['text'])
  expectEqual(resolve('mimo-v2.5-pro').capabilities.inputs, ['text'])
  expectTruthy(resolve('mimo-unknown').issues.length > 0)
})

test('OpenAI-compatible accepts arbitrary models under its fixed text contract', () => {
  const resolved = registry.get('openai-compatible').resolve({
    providerValues: { endpoint: 'https://example.test/v1' },
    values: { model: 'custom-model-id' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.issues, [])
  expectEqual(resolved.capabilities.inputs, ['text'])
  expectEqual(resolved.capabilities.instructions, true)
})

test('validation rejects malformed discovery and selection fields', () => {
  const base = () => ({
    id: 'broken',
    manifest: {
      label: 'Broken',
      fields: [
        { key: 'endpoint', type: 'url', label: 'Endpoint' },
        { key: 'key', type: 'secret', label: 'API key', env: [] }
      ],
      selectionFields: [{ key: 'model', type: 'string', label: 'Model' }],
      support: { inputs: ['audio'], instructions: false }
    },
    resolve: () => {},
    create: () => {}
  })
  expectEqual(validateProvider(base()), [])

  const noInputs = base()
  noInputs.manifest.support.inputs = []
  expectTruthy(validateProvider(noInputs).length > 0)

  const noInstructions = base()
  delete noInstructions.manifest.support.instructions
  expectTruthy(validateProvider(noInstructions).length > 0)

  const badType = base()
  badType.manifest.selectionFields[0].type = 'magic'
  expectTruthy(validateProvider(badType).length > 0)

  const noEnv = base()
  delete noEnv.manifest.fields[1].env
  expectTruthy(validateProvider(noEnv).length > 0)
})

await run()
