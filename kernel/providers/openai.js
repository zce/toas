// OpenAI and bring-your-own OpenAI-compatible text Providers share one
// explicit Chat Completions contract. This module must not import GNOME/GI.

import { processingError } from '../error.js'
import { ChatCompletionsProcessor, extractContent, normalizeUsage } from './chat-completions.js'
import { Provider } from './provider.js'

// One class, two configurations: the official endpoint ships a default
// model, the compatible variant requires a user-configured base URL.
class OpenAICompatibleProvider extends Provider {
  constructor({ id, label, endpointDefault = undefined, endpointEnv, keyEnv, modelDefault = undefined }) {
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
        selectionFields: [
          { key: 'model', type: 'string', label: 'Model', required: true },
          {
            key: 'thinking',
            type: 'string',
            label: 'Thinking',
            subtitle: id === 'openai'
              ? 'Only models supporting none can disable reasoning.'
              : 'Uses reasoning_effort: none; the endpoint must support it.',
            inputs: ['text'],
            advanced: true,
            choices: [
              { value: 'off', label: 'Off' },
              { value: 'default', label: 'Provider default' }
            ]
          }
        ],
        support: { inputs: ['text'], instructions: true },
        defaults: {
          text: {
            ...(modelDefault ? { model: modelDefault } : {}),
            thinking: id === 'openai-compatible' ? 'default' : 'off'
          }
        }
      }
    })
  }

  resolveSelection({ providerValues, values }) {
    const model = values.model?.trim()
    const storedThinking = values.thinking ?? (this.id === 'openai-compatible' ? 'default' : 'off')
    const requestedThinking = storedThinking === 'off' ? 'off' : 'default'
    const canDisableThinking =
      this.id === 'openai-compatible' || supportsOpenAIReasoningNone(model)

    return {
      input: 'text',
      config: {
        endpoint: providerValues.endpoint?.trim(),
        model,
        thinking: canDisableThinking ? requestedThinking : 'default'
      },
      capabilities: textCapabilities(),
      issues: []
    }
  }

  createProcessor(config, secrets, runtime) {
    return new OpenAICompatibleProcessor(this, config, secrets.key, runtime)
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

// Match supported model families rather than maintaining every model ID.
const OPENAI_REASONING_NONE_PREFIXES = [
  'gpt-5.',
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-6-luna'
]
const OPENAI_REASONING_NONE_EXCLUDED_VARIANTS = new Set(['pro', 'codex', 'cyber'])

function supportsOpenAIReasoningNone(model) {
  if (typeof model !== 'string') return false

  const modelId = model.trim().toLowerCase()
  if (!modelId || modelId.split('-').some(part => OPENAI_REASONING_NONE_EXCLUDED_VARIANTS.has(part))) {
    return false
  }

  return OPENAI_REASONING_NONE_PREFIXES.some(prefix => modelId.startsWith(prefix))
}

function textCapabilities() {
  return { inputs: ['text'], instructions: true, context: true }
}

class OpenAICompatibleProcessor extends ChatCompletionsProcessor {
  async process({ input, context, instructions, signal }) {
    if (input.kind !== 'text') {
      throw processingError('configuration', `${this._label} processing requires text input`)
    }

    const data = await this._send(
      {
        model: this._config.model,
        messages: this._refineMessages({
          transcript: input.text,
          context,
          instructions
        }),
        ...(this._config.thinking === 'off' ? { reasoning_effort: 'none' } : {}),
        stream: false
      },
      signal
    )

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
