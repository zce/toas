// Provider contract and selection-resolved capability checks.

import { Provider } from '../kernel/providers/provider.js'
import { providers } from '../kernel/providers/registry.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const PRESENT = { key: true }

test('every registered Provider extends the shared template', () => {
  for (const [id, provider] of providers) {
    expectTruthy(provider instanceof Provider)
    expectEqual(provider.id, id)
  }
})

test('manifest required fields are validated once by the Provider template', () => {
  const resolved = providers.get('mimo').resolve({
    providerValues: {},
    values: {},
    secretPresence: {}
  })
  expectEqual(
    resolved.issues
      .filter(issue => issue.code === 'required')
      .map(issue => issue.path)
      .sort(),
    ['providers.mimo.endpoint', 'providers.mimo.key', 'values.model']
  )
})

test('MiMo defaults to the API endpoint and preserves explicit overrides', () => {
  const mimo = providers.get('mimo')
  expectEqual(mimo.manifest.fields.find(field => field.key === 'endpoint').default, 'https://api.xiaomimimo.com/v1')

  const resolved = mimo.resolve({
    providerValues: { endpoint: 'https://token-plan-cn.xiaomimimo.com/v1' },
    values: { model: 'mimo-v2.5-asr' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.issues, [])
  expectEqual(resolved.config.endpoint, 'https://token-plan-cn.xiaomimimo.com/v1')
})

test('Doubao presents Model while forwarding it as the Speech API resource ID', () => {
  const doubao = providers.get('doubao')
  expectEqual(doubao.manifest.selectionFields.find(field => field.key === 'model').label, 'Model')
  const resolved = doubao.resolve({
    providerValues: { endpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash' },
    values: { model: 'volc.bigasr.auc_turbo' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.config.resourceId, 'volc.bigasr.auc_turbo')
})

test('manifest support is discovery only and resolved capabilities are explicit', () => {
  const qwen = providers.get('qwen')
  expectEqual(qwen.manifest.support.inputs, ['audio'])
  const resolved = qwen.resolve({
    providerValues: { endpoint: '' },
    values: { model: 'qwen-audio-3.1-asr-flash' },
    secretPresence: PRESENT
  })
  expectEqual(resolved.capabilities, {
    inputs: ['audio'],
    instructions: false,
    context: true
  })
})

test('MiMo role decides audio or Refine regardless of the model ID', () => {
  const provider = providers.get('mimo')
  const resolve = (model, role) => provider.resolve({
    providerValues: { endpoint: 'https://example.test/v1' },
    values: { model }, secretPresence: PRESENT, role
  })
  expectEqual(resolve('future-asr', 'primary').capabilities.inputs, ['audio'])
  expectEqual(resolve('future-text', 'refine').capabilities.inputs, ['text'])
  expectEqual(resolve('future-text', 'refine').issues, [])
  expectEqual(resolve('', 'primary').issues[0].path, 'values.model')
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
