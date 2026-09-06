import { Provider } from '../kernel/providers/provider.js'
import { test, expectEqual, run } from './harness.js'

class ScopedProvider extends Provider {
  constructor () {
    super({
      id: 'scoped',
      manifest: {
        label: 'Scoped',
        fields: [
          { key: 'key', type: 'secret', label: 'API key', required: true }
        ],
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

  resolveSelection ({ values }) {
    const input = values.model === 'audio-model'
      ? 'audio'
      : values.model === 'text-model'
        ? 'text'
        : null
    return {
      input,
      config: input ? { ...values } : null,
      capabilities: input
        ? { inputs: [input], instructions: input === 'text', context: false }
        : null,
      issues: input
        ? []
        : values.model
          ? [{ path: 'values.model', code: 'unsupported', message: 'Unsupported model' }]
          : []
    }
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

await run()
