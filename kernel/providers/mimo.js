// MiMo Provider: one Chat Completions protocol for ASR and Refine.
// This module must not import GNOME/GI libraries.

import { processingError } from '../error.js'
import { ChatCompletionsProcessor, extractContent, normalizeUsage } from './chat-completions.js'
import { Provider } from './provider.js'

// Input contract follows the selected processing role, not model naming.
const AUDIO_CAPABILITIES = { inputs: ['audio'], instructions: false, context: false }
const TEXT_CAPABILITIES = { inputs: ['text'], instructions: true, context: true }

class MimoProvider extends Provider {
  constructor() {
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
            inputs: ['audio']
          },
          {
            key: 'model',
            type: 'string',
            label: 'Model',
            required: true,
            inputs: ['text']
          },
          {
            key: 'thinking',
            type: 'string',
            label: 'Thinking',
            inputs: ['text'],
            advanced: true,
            choices: [
              { value: 'off', label: 'Off' },
              { value: 'default', label: 'Provider default' }
            ]
          },
          { key: 'language', type: 'string', label: 'Language', inputs: ['audio'] }
        ],
        support: { inputs: ['audio', 'text'], instructions: true },
        defaults: {
          audio: { model: 'mimo-v2.5-asr', language: 'auto' },
          text: { model: 'mimo-v2.6-flash', thinking: 'off' }
        }
      }
    })
  }

  resolveSelection({ providerValues, values, role = 'primary' }) {
    const input = role === 'refine' ? 'text' : 'audio'
    return {
      input,
      config: {
        endpoint: providerValues.endpoint?.trim(),
        model: values.model?.trim() || '',
        input,
        ...(input === 'audio'
          ? { language: values.language?.trim() || 'auto' }
          : { thinking: values.thinking === 'default' ? 'default' : 'off' })
      },
      capabilities: input === 'audio' ? AUDIO_CAPABILITIES : TEXT_CAPABILITIES,
      issues: []
    }
  }

  createProcessor(config, secrets, runtime) {
    return new MimoProcessor(this, config, secrets.key, runtime)
  }
}

export const mimoProvider = new MimoProvider()

class MimoProcessor extends ChatCompletionsProcessor {
  constructor(provider, config, apiKey, runtime) {
    super(provider, config, apiKey, runtime)
  }

  // One wire protocol, two message shapes: audio selections inline the
  // recording as input_audio; text selections reuse the shared Refine
  // prompt composition.
  async process({ input, context, instructions, signal }) {
    let messages

    if (this._config.input === 'audio') {
      if (input.kind !== 'audio') {
        throw processingError('configuration', 'This MiMo selection requires audio input')
      }
      messages = [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: `data:${input.mimeType};base64,${input.base64}` }
            }
          ]
        }
      ]
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
      ...(this._config.input === 'text' && this._config.thinking === 'off'
        ? { thinking: { type: 'disabled' } }
        : {}),
      ...(this._config.input === 'audio' ? { asr_options: { language: this._config.language ?? 'auto' } } : {}),
      stream: false
    }

    const data = await this._send(requestBody, signal)
    const text = extractContent(data)
    if (!text.trim()) {
      throw processingError('no-text', this._config.input === 'audio' ? 'No speech was recognized' : 'MiMo text processing returned no text')
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
