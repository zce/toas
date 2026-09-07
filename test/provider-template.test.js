// Provider base template behavior with a scoped test double.

import { Provider } from '../kernel/providers/provider.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

class ScopedProvider extends Provider {
  constructor() {
    super({
      id: 'scoped',
      manifest: {
        label: 'Scoped',
        fields: [{ key: 'key', type: 'secret', label: 'API key', required: true }],
        selectionFields: [
          { key: 'model', type: 'string', label: 'Model', required: true, inputs: ['audio'] },
          { key: 'model', type: 'string', label: 'Model', required: true, inputs: ['text'] },
          { key: 'language', type: 'string', label: 'Language', required: true, inputs: ['audio'] },
          { key: 'style', type: 'string', label: 'Style', required: true, inputs: ['text'] }
        ],
        support: { inputs: ['audio', 'text'], instructions: true },
        defaults: {}
      }
    })
  }

  resolveSelection({ values }) {
    const input = values.model === 'audio-model' ? 'audio' : values.model === 'text-model' ? 'text' : null
    return {
      input,
      config: input ? { ...values } : null,
      capabilities: input ? { inputs: [input], instructions: input === 'text', context: false } : null,
      issues: input ? [] : values.model ? [{ path: 'values.model', code: 'unsupported', message: 'Unsupported model' }] : []
    }
  }

  createProcessor(config, secrets, runtime) {
    return { config, secrets, runtime }
  }
}

const provider = new ScopedProvider()
const secretPresence = { key: true }

test('Provider resolve template always applies shared required validation', () => {
  const resolved = provider.resolve({
    providerValues: {},
    values: { model: 'text-model', style: 'concise' },
    secretPresence: {}
  })

  expectEqual(
    resolved.issues.map(issue => issue.path),
    ['providers.scoped.key']
  )
})

test('required selection fields are scoped to the resolved input', () => {
  const text = provider.resolve({
    providerValues: {},
    values: { model: 'text-model', style: 'concise' },
    secretPresence
  })
  expectEqual(text.issues, [])

  const audio = provider.resolve({
    providerValues: {},
    values: { model: 'audio-model' },
    secretPresence
  })
  expectEqual(
    audio.issues.map(issue => issue.path),
    ['values.language']
  )
})

test('unresolved input reports universally required keys only', () => {
  const resolved = provider.resolve({
    providerValues: {},
    values: {},
    secretPresence
  })

  expectEqual(
    resolved.issues.map(issue => issue.path),
    ['values.model']
  )
})

test('Provider discovery support stays behind the shared template', () => {
  expectEqual(provider.supports('audio'), true)
  expectEqual(provider.supports('text', { instructions: true }), true)
  expectEqual(provider.supports('image'), false)
})

test('known model-shape lookup trims values and reports unsupported models consistently', () => {
  const shapes = { known: { input: 'text' } }
  expectEqual(provider.resolveModelShape({ model: ' known ' }, shapes), {
    model: 'known',
    shape: shapes.known,
    issues: []
  })

  const unknown = provider.resolveModelShape({ model: 'other' }, shapes)
  expectEqual(unknown.model, 'other')
  expectEqual(unknown.shape, null)
  expectEqual(unknown.issues, [
    {
      path: 'values.model',
      code: 'unsupported',
      message: 'Unsupported Scoped model: other'
    }
  ])
})

test('Provider create template validates required secrets before delegating', () => {
  let error = null
  try {
    provider.create({}, {}, {})
  } catch (caught) {
    error = caught
  }
  expectTruthy(error)
  expectEqual(error.category, 'configuration')
  expectEqual(error.message, 'Scoped API key is required to create a processor')

  const processor = provider.create({ model: 'text-model' }, { key: 'secret' }, { transport: 'runtime' })
  expectEqual(processor, {
    config: { model: 'text-model' },
    secrets: { key: 'secret' },
    runtime: { transport: 'runtime' }
  })
})

await run()
