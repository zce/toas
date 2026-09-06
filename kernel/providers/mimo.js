// MiMo Provider: explicit selection mappings over one shared service.
// This module must not import GNOME/GI libraries.

import { processingError } from '../error.js'
import { Provider } from './provider.js'
import {
  ChatCompletionsProcessor,
  extractContent,
  normalizeUsage
} from './chat-completions.js'

const MODEL_SHAPES = {
  'mimo-v2.5-asr': {
    input: 'audio',
    capabilities: { inputs: ['audio'], instructions: false, context: false }
  },
  'mimo-v2.5': {
    input: 'text',
    capabilities: { inputs: ['text'], instructions: true, context: true }
  },
  'mimo-v2.5-pro': {
    input: 'text',
    capabilities: { inputs: ['text'], instructions: true, context: true }
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

  resolveSelection ({ providerValues, values }) {
    const endpoint = providerValues.endpoint?.trim()
    const { model, shape, issues } = this.resolveModelShape(values, MODEL_SHAPES)
    const language = values.language?.trim() || null

    return {
      input: shape?.input ?? null,
      config: shape
        ? { endpoint, model, ...(language ? { language } : {}) }
        : null,
      capabilities: shape?.capabilities ?? null,
      issues
    }
  }

  createProcessor (config, secrets, runtime) {
    return new MimoProcessor(this, config, secrets.key, runtime, MODEL_SHAPES[config.model])
  }
}

export const mimoProvider = new MimoProvider()

class MimoProcessor extends ChatCompletionsProcessor {
  constructor (provider, config, apiKey, runtime, shape) {
    super(provider, config, apiKey, runtime)
    this._shape = shape
  }

  async process ({ input, context, instructions, signal }) {
    let messages

    if (this._shape.input === 'audio') {
      if (input.kind !== 'audio') {
        throw processingError('configuration', 'This MiMo selection requires audio input')
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
      messages = this._refineMessages({
        transcript: input.text,
        context,
        instructions
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
      usage: normalizeUsage(data.usage),
      requestId: null,
      responseId: data.id ?? null
    }
  }
}
