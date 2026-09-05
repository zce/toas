// OpenAI Provider: verified text-processing selections over Chat Completions.
// Bring-your-own OpenAI-compatible endpoints are served by the
// openai-compatible Provider, keeping official defaults separate.
// This module must not import GNOME/GI libraries.

import { Provider } from './provider.js'
import {
  ChatCompletionsProcessor,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  processingError
} from './chat-completions.js'

class OpenAIProvider extends Provider {
  constructor () {
    super({
      id: 'openai',
      manifest: {
        label: 'OpenAI',

        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Service base URL',
            required: true,
            default: 'https://api.openai.com/v1',
            env: ['TOAS_OPENAI_ENDPOINT', 'OPENAI_API_BASE']
          },
          {
            key: 'key',
            type: 'secret',
            label: 'API key',
            required: true,
            env: ['TOAS_OPENAI_API_KEY', 'OPENAI_API_KEY']
          }
        ],

        selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        support: { inputs: ['text'], instructions: true },
        defaults: { text: { model: 'gpt-4o-mini' } }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.openai.key',
        code: 'required',
        message: 'An OpenAI API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    if (!endpoint) {
      issues.push({
        path: 'providers.openai.endpoint',
        code: 'required',
        message: 'An OpenAI service base URL is required'
      })
    }

    const model = values.model?.trim()
    if (!model) {
      issues.push({
        path: 'values.model',
        code: 'required',
        message: 'An OpenAI model is required'
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: textCapabilities(), issues }
    }

    return {
      config: { endpoint, model },
      capabilities: textCapabilities(),
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'An OpenAI API key is required to create a processor')
    }
    return new OpenAICompatibleProcessor('OpenAI', config, secrets.key, runtime)
  }
}

export const openaiProvider = new OpenAIProvider()

// Bring-your-own OpenAI-compatible text endpoint. Arbitrary model ids are
// accepted because this integration promises one explicit wire contract.
class OpenAICompatibleProvider extends Provider {
  constructor () {
    super({
      id: 'openai-compatible',
      manifest: {
        label: 'OpenAI-compatible',

        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Service base URL',
            required: true,
            env: ['TOAS_OPENAI_COMPATIBLE_ENDPOINT']
          },
          {
            key: 'key',
            type: 'secret',
            label: 'API key',
            required: true,
            env: ['TOAS_OPENAI_COMPATIBLE_API_KEY']
          }
        ],

        selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        support: { inputs: ['text'], instructions: true },
        defaults: { text: {} }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.openai-compatible.key',
        code: 'required',
        message: 'An API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    if (!endpoint) {
      issues.push({
        path: 'providers.openai-compatible.endpoint',
        code: 'required',
        message: 'A service base URL is required'
      })
    }

    const model = values.model?.trim()
    if (!model) {
      issues.push({
        path: 'values.model',
        code: 'required',
        message: 'A model is required'
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: textCapabilities(), issues }
    }

    return {
      config: { endpoint, model },
      capabilities: textCapabilities(),
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'An API key is required to create a processor')
    }
    return new OpenAICompatibleProcessor('OpenAI-compatible', config, secrets.key, runtime)
  }
}

export const openaiCompatibleProvider = new OpenAICompatibleProvider()

function textCapabilities () {
  return { inputs: ['text'], instructions: true, context: true, integratedRefine: false }
}

class OpenAICompatibleProcessor extends ChatCompletionsProcessor {
  async process ({ input, context, instructions, signal }) {
    if (input.kind !== 'text') {
      throw processingError('configuration', `${this._label} processing requires text input`)
    }

    const messages = []
    // Context is Host-supplied free text the user composed; it is passed
    // verbatim so the user's own phrasing reaches the model intact.
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
      finishReason: normalizeFinishReason(data.choices?.[0]?.finish_reason),
      usage: normalizeUsage(data.usage),
      requestId: null,
      responseId: data.id ?? null
    }
  }
}
