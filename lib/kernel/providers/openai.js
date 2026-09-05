// OpenAI Provider: separate refine only. Protocol compatibility does not
// imply product capability — the official service has a tested refine
// implementation, so that role is exposed and nothing more.
// Bring-your-own OpenAI-compatible endpoints are served by the
// openai-compatible Provider, keeping official defaults separate.
// This module must not import GNOME/GI libraries.

import {
  encodeBody,
  decodeBody,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  serviceErrorFromStatus,
  processingError,
  cancelledError,
  normalizeChatCompletionsUrl
} from './chat-helpers.js'

export const openaiProvider = {
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

    refine: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'gpt-4o-mini' }
      ],
      capabilities: { context: true }
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []

    if (role !== 'refine') {
      issues.push({
        path: 'provider',
        code: 'unsupported-role',
        message: 'OpenAI supports refine only, not primary processing'
      })
      return { config: null, capabilities: null, issues }
    }

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
        path: 'refine.values.model',
        code: 'required',
        message: 'An OpenAI refine model is required'
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint, model },
      capabilities: this.manifest.refine.capabilities,
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'An OpenAI API key is required to create a processor')
    }
    return new OpenAICompatibleProcessor('OpenAI', config, secrets.key, runtime)
  }
}

// Bring-your-own OpenAI-compatible refine endpoint. Wire compatibility is
// scoped to the tested refine implementation: no primary processing role is
// exposed, because "OpenAI-compatible" does not standardize audio primary
// semantics.
export const openaiCompatibleProvider = {
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

    refine: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true }
      ],
      capabilities: { context: true }
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []

    if (role !== 'refine') {
      issues.push({
        path: 'provider',
        code: 'unsupported-role',
        message: 'OpenAI-compatible endpoints support refine only'
      })
      return { config: null, capabilities: null, issues }
    }

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
        path: 'refine.values.model',
        code: 'required',
        message: 'A refine model is required'
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: { endpoint, model },
      capabilities: this.manifest.refine.capabilities,
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'An API key is required to create a processor')
    }
    return new OpenAICompatibleProcessor('OpenAI-compatible', config, secrets.key, runtime)
  }
}

class OpenAICompatibleProcessor {
  constructor (label, config, apiKey, runtime) {
    this._label = label
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  async process ({ input, context, instructions, signal }) {
    if (input.kind !== 'text') {
      throw processingError('configuration', `${this._label} refine requires text input`)
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
      throw processingError('no-text', `${this._label} refine returned no text`)
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
      throw serviceErrorFromStatus(response.status, response.body, this._label)
    }

    return decodeBody(response.body)
  }
}
