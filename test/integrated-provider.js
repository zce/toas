import { Provider } from '../kernel/providers/provider.js'

// Test Provider with an explicit integrated-refine capability, used only by
// Kernel tests to exercise the integrated branch. No production Provider
// advertises integrated refine until a dedicated semantic verification
// demonstrates product-level Refine, not merely prompt acceptance.
//
// This module must not import GNOME/GI libraries.

class TestIntegratedProvider extends Provider {
  constructor () {
    super({
      id: 'test-integrated',
      manifest: {
        label: 'Test Integrated Provider',
        fields: [
          { key: 'endpoint', type: 'url', label: 'Endpoint', required: true, default: 'https://test.example.com' },
          { key: 'key', type: 'secret', label: 'API key', required: true }
        ],
        selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        support: { inputs: ['audio'], instructions: false },
        defaults: { audio: { model: 'test-integrated-model' } }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.test-integrated.key',
        code: 'required',
        message: 'A test API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    const model = values.model?.trim() || this.manifest.defaults.audio.model

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint, model },
      capabilities: {
        inputs: ['audio'],
        instructions: false,
        context: true,
        integratedRefine: true
      },
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw new Error('A test API key is required to create a processor')
    }
    return new TestIntegratedProcessor(config)
  }
}

export const testIntegratedProvider = new TestIntegratedProvider()

class TestIntegratedProcessor {
  constructor (config) {
    this._config = config
    this.calls = []
  }

  async process ({ input, context, instructions, signal }) {
    this.calls.push({
      inputKind: input.kind,
      context: { text: context.text },
      instructions: instructions ?? null,
      signal
    })

    if (input.kind !== 'audio') {
      throw new Error('test-integrated processor requires audio input')
    }

    let text = 'test transcription'
    if (instructions?.trim()) {
      text = `${text} [refined with: ${instructions.substring(0, 20)}...]`
    }
    if (context.text?.trim()) {
      text = `${text} [context present]`
    }

    return {
      text,
      model: this._config.model,
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      requestId: 'test-req-123',
      responseId: 'test-resp-456'
    }
  }
}
