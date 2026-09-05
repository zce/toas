// MiMo Provider: explicit selection mappings over one shared service.
// This module must not import GNOME/GI libraries.

import { Provider } from './provider.js'
import {
  ChatCompletionsProcessor,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  processingError
} from './chat-completions.js'

const MODEL_SHAPES = {
  'mimo-v2.5-asr': {
    input: 'audio',
    capabilities: { inputs: ['audio'], instructions: false, context: false, integratedRefine: false }
  },
  'mimo-v2.5': {
    input: 'text',
    capabilities: { inputs: ['text'], instructions: true, context: true, integratedRefine: false }
  },
  'mimo-v2.5-pro': {
    input: 'text',
    capabilities: { inputs: ['text'], instructions: true, context: true, integratedRefine: false }
  }
}

class MimoProvider extends Provider {
  constructor () {
    super({
      id: 'mimo',
      manifest: {
        label: 'MiMo',

        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Service base URL',
            required: true,
            default: 'https://token-plan-cn.xiaomimimo.com/v1',
            env: ['TOAS_MIMO_ENDPOINT', 'MIMO_ENDPOINT']
          },
          {
            key: 'key',
            type: 'secret',
            label: 'API key',
            required: true,
            env: ['TOAS_MIMO_API_KEY', 'MIMO_API_KEY']
          }
        ],

        selectionFields: [
          {
            key: 'model',
            type: 'string',
            label: 'Model',
            required: true,
            inputs: ['audio'],
            choices: [{ value: 'mimo-v2.5-asr', label: 'mimo-v2.5-asr' }]
          },
          {
            key: 'model',
            type: 'string',
            label: 'Model',
            required: true,
            inputs: ['text'],
            choices: [
              { value: 'mimo-v2.5', label: 'mimo-v2.5' },
              { value: 'mimo-v2.5-pro', label: 'mimo-v2.5-pro' }
            ]
          },
          { key: 'language', type: 'string', label: 'Language', inputs: ['audio'] }
        ],
        support: { inputs: ['audio', 'text'], instructions: true },
        defaults: {
          audio: { model: 'mimo-v2.5-asr', language: 'auto' },
          text: { model: 'mimo-v2.5' }
        }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.mimo.key',
        code: 'required',
        message: 'A MiMo API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    if (!endpoint) {
      issues.push({
        path: 'providers.mimo.endpoint',
        code: 'required',
        message: 'A MiMo service base URL is required'
      })
    }

    const model = values.model?.trim()
    if (!model) {
      issues.push({
        path: 'values.model',
        code: 'required',
        message: 'A MiMo model is required'
      })
    }

    const shape = model ? MODEL_SHAPES[model] : null
    if (model && !shape) {
      issues.push({
        path: 'values.model',
        code: 'unsupported',
        message: `Unsupported MiMo model: ${model}`
      })
    }

    const language = values.language?.trim() || null

    if (issues.length > 0) {
      return { config: null, capabilities: shape?.capabilities ?? null, issues }
    }

    return {
      config: { endpoint, model, ...(language ? { language } : {}) },
      capabilities: shape.capabilities,
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'A MiMo API key is required to create a processor')
    }
    return new MimoProcessor(config, secrets.key, runtime, MODEL_SHAPES[config.model])
  }
}

export const mimoProvider = new MimoProvider()

class MimoProcessor extends ChatCompletionsProcessor {
  constructor (config, apiKey, runtime, shape) {
    super('MiMo', config, apiKey, runtime)
    this._shape = shape
  }

  async process ({ input, context, instructions, signal }) {
    let messages

    if (this._shape.input === 'audio') {
      if (input.kind !== 'audio') {
        throw processingError('configuration', 'This MiMo selection requires audio input')
      }
      if (instructions != null && instructions !== '') {
        throw processingError('configuration', 'MiMo does not support integrated refine')
      }
      messages = [{
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: { data: `data:${input.mimeType};base64,${input.base64}` }
        }]
      }]
    } else {
      if (input.kind !== 'text') {
        throw processingError('configuration', 'This MiMo selection requires text input')
      }
      messages = []
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
    }

    const requestBody = {
      model: this._config.model,
      messages,
      ...(this._shape.input === 'audio'
        ? { asr_options: { language: this._config.language ?? 'auto' } }
        : {}),
      stream: false
    }

    const data = await this._send(requestBody, signal)

    const text = extractContent(data)
    if (!text.trim()) {
      throw processingError('no-text', this._shape.input === 'audio'
        ? 'No speech was recognized'
        : 'MiMo text processing returned no text')
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
