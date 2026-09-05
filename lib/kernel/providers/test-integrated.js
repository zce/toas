// Test Provider with an explicit integrated-refine capability, used only by
// Kernel tests to exercise the integrated branch. No production Provider
// advertises integrated refine until a dedicated semantic verification
// demonstrates product-level Refine, not merely prompt acceptance.
//
// This module must not import GNOME/GI libraries.

export const testIntegratedProvider = {
  id: 'test-integrated',

  manifest: {
    label: 'Test Integrated Provider',

    fields: [
      { key: 'endpoint', type: 'url', label: 'Endpoint', required: true, default: 'https://test.example.com' },
      { key: 'key', type: 'secret', label: 'API key', required: true }
    ],

    processing: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'test-integrated-model' }
      ],
      capabilities: {
        context: true,
        integratedRefine: true
      }
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []

    if (role !== 'processing') {
      issues.push({
        path: 'provider',
        code: 'unsupported-role',
        message: `test-integrated does not support the ${role} role`
      })
      return { config: null, capabilities: null, issues }
    }

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.test-integrated.key',
        code: 'required',
        message: 'A test API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    const model = values.model?.trim() || this.manifest.processing.fields[0].default

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint, model },
      capabilities: this.manifest.processing.capabilities,
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw new Error('A test API key is required to create a processor')
    }
    return new TestIntegratedProcessor(config, secrets.key, runtime)
  }
}

class TestIntegratedProcessor {
  constructor (config, apiKey, runtime) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
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
