// OpenAI and bring-your-own OpenAI-compatible text Providers share one
// explicit Chat Completions contract. This module must not import GNOME/GI.

import { Provider } from './provider.js'
import {
  ChatCompletionsProcessor,
  extractContent,
  normalizeUsage,
  processingError
} from './chat-completions.js'

class OpenAICompatibleProvider extends Provider {
  constructor ({ id, label, endpointDefault = undefined, endpointEnv, keyEnv, modelDefault = undefined }) {
    super({
      id,
      manifest: {
        label,
        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Service base URL',
            required: true,
            ...(endpointDefault !== undefined ? { default: endpointDefault } : {}),
            env: endpointEnv
          },
          {
            key: 'key',
            type: 'secret',
            label: 'API key',
            required: true,
            env: keyEnv
          }
        ],
        selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        support: { inputs: ['text'], instructions: true },
        defaults: { text: modelDefault ? { model: modelDefault } : {} }
      }
    })
  }

  resolveSelection ({ providerValues, values }) {
    return {
      input: 'text',
      config: {
        endpoint: providerValues.endpoint?.trim(),
        model: values.model?.trim()
      },
      capabilities: textCapabilities(),
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', `${this.manifest.label} API key is required to create a processor`)
    }
    return new OpenAICompatibleProcessor(this.manifest.label, config, secrets.key, runtime)
  }
}

export const openaiProvider = new OpenAICompatibleProvider({
  id: 'openai',
  label: 'OpenAI',
  endpointDefault: 'https://api.openai.com/v1',
  endpointEnv: ['TOAS_OPENAI_ENDPOINT', 'OPENAI_API_BASE'],
  keyEnv: ['TOAS_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  modelDefault: 'gpt-4o-mini'
})

export const openaiCompatibleProvider = new OpenAICompatibleProvider({
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  endpointEnv: ['TOAS_OPENAI_COMPATIBLE_ENDPOINT'],
  keyEnv: ['TOAS_OPENAI_COMPATIBLE_API_KEY']
})

function textCapabilities () {
  return { inputs: ['text'], instructions: true, context: true }
}

class OpenAICompatibleProcessor extends ChatCompletionsProcessor {
  async process ({ input, context, instructions, signal }) {
    if (input.kind !== 'text') {
      throw processingError('configuration', `${this._label} processing requires text input`)
    }

    const messages = []
    const contextText = context.text?.trim()
    if (contextText) {
      messages.push({ role: 'system', content: contextText })
    }
    messages.push({
      role: 'user',
      content: instructions?.trim() ? `${instructions}\n\n${input.text}` : input.text
    })

    const data = await this._send({
      model: this._config.model,
      messages,
      stream: false
    }, signal)

    const text = extractContent(data)
    if (!text.trim()) {
      throw processingError('no-text', `${this._label} text processing returned no text`)
    }

    return {
      text: text.trim(),
      model: data.model || this._config.model,
      usage: normalizeUsage(data.usage),
      requestId: null,
      responseId: data.id ?? null
    }
  }
}
