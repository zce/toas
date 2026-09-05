// Provider contract and selection-resolved capability checks.

import { Provider } from '../kernel/providers/provider.js'
import { providers } from '../kernel/providers/registry.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const PRESENT = { key: true }

test('every registered Provider extends the shared template', () => {
  for (const [id, provider] of providers) {
    expectTruthy(provider instanceof Provider)
    expectEqual(provider.id, id)
  }
})

test('manifest support is discovery only and resolved capabilities are explicit', () => {
  const qwen = providers.get('qwen')
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
  const mimo = providers.get('mimo')
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
  const resolved = providers.get('openai-compatible').resolve({
    providerValues: { endpoint: 'https://example.test/v1' },
    values: { model: 'custom-model-id' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.issues, [])
  expectEqual(resolved.capabilities.inputs, ['text'])
  expectEqual(resolved.capabilities.instructions, true)
})

await run()
