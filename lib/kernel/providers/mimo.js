// MiMo Provider: one cohesive service integration with two roles.
// Primary: MiMo ASR over OpenAI-style Chat Completions (current verified
// mapping, no Context). Refine: MiMo text models with terms/passages Context.
// Shared endpoint and credential live at the Provider level.
// This module must not import GNOME/GI libraries.

import {
  encodeBody,
  decodeBody,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  serviceErrorFromStatus,
  protocolError,
  cancelledError,
  normalizeChatCompletionsUrl
} from './chat-helpers.js'

export const mimoProvider = {
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

    processing: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'mimo-v2.5-asr' },
        { key: 'language', type: 'string', label: 'Language', default: 'auto' }
      ],
      // The known MiMo ASR mapping has no verified Context support; keep it
      // conservative until a mapping is tested.
      capabilities: { context: [], integratedRefine: false }
    },

    refine: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true }
      ],
      capabilities: { context: ['terms', 'passages'] }
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []
    const roleManifest = this.manifest[role]

    if (!roleManifest) {
      issues.push({
        path: role === 'refine' ? 'refine.provider' : 'provider',
        code: 'unsupported-role',
        message: `MiMo does not support the ${role} role`
      })
      return { config: null, capabilities: null, issues }
    }

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
        path: role === 'refine' ? 'refine.values.model' : 'values.model',
        code: 'required',
        message: 'A MiMo model is required'
      })
    }

    const language = values.language?.trim() || null

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint, model, ...(language ? { language } : {}) },
      capabilities: roleManifest.capabilities,
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw protocolError('configuration', 'A MiMo API key is required to create a processor')
    }
    return new MimoProcessor(role, config, secrets.key, runtime)
  }
}

class MimoProcessor {
  constructor (role, config, apiKey, runtime) {
    this._role = role
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  async process ({ input, context, instructions, signal }) {
    let messages

    if (this._role === 'processing') {
      if (input.kind !== 'audio') {
        throw protocolError('configuration', 'MiMo primary processing requires audio input')
      }
      if (instructions != null && instructions !== '') {
        throw protocolError('configuration', 'MiMo does not support integrated refine')
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
        throw protocolError('configuration', 'MiMo refine requires text input')
      }
      messages = []
      const systemParts = []
      if (context.terms?.length > 0) {
        systemParts.push(`Technical terms: ${context.terms.join(', ')}`)
      }
      if (context.passages?.length > 0) {
        systemParts.push(`Context:\n${context.passages.join('\n')}`)
      }
      if (systemParts.length > 0) {
        messages.push({ role: 'system', content: systemParts.join('\n\n') })
      }
      messages.push({
        role: 'user',
        content: instructions?.trim() ? `${instructions}\n\n${input.text}` : input.text
      })
    }

    const requestBody = {
      model: this._config.model,
      messages,
      ...(this._role === 'processing'
        ? { asr_options: { language: this._config.language ?? 'auto' } }
        : {}),
      stream: false
    }

    const data = await this._send(requestBody, signal)

    const text = extractContent(data)
    if (!text.trim()) {
      throw protocolError('no-text', this._role === 'processing'
        ? 'No speech was recognized'
        : 'MiMo refine returned no text')
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

  async _send (requestBody, signal) {
    const response = await this._runtime.transport.send({
      method: 'POST',
      url: normalizeChatCompletionsUrl(this._config.endpoint),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`
      },
      body: encodeBody(requestBody)
    }, signal)

    if (signal?.aborted) { throw cancelledError() }

    if (response.status < 200 || response.status >= 300) {
      throw serviceErrorFromStatus(response.status, response.body, 'MiMo')
    }

    return decodeBody(response.body)
  }
}
