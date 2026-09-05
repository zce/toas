// Qwen Provider (DashScope multimodal-generation, HTTP non-realtime).
// Primary processing only; separate refine is not offered because the
// verified ASR mapping has no tested text-refine implementation.
// This module must not import GNOME/GI libraries.

import {
  encodeBody,
  decodeBody,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  serviceErrorFromStatus,
  protocolError,
  cancelledError
} from './chat-helpers.js'

// Explicit, tested capability mapping. Unknown models stay conservative:
// no Context, no integrated refine. Capability is never guessed from a
// model-name pattern or from generic prompt acceptance.
const MODEL_CAPABILITIES = {
  'qwen3-asr-flash': { context: ['terms', 'passages'], integratedRefine: false },
  'qwen-audio-3.0-asr-flash': { context: ['terms', 'passages'], integratedRefine: false }
}

export const qwenProvider = {
  id: 'qwen',

  manifest: {
    label: 'Qwen',

    fields: [
      {
        key: 'endpoint',
        type: 'url',
        label: 'Endpoint',
        required: true,
        default: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        env: ['TOAS_QWEN_ENDPOINT', 'DASHSCOPE_ENDPOINT']
      },
      {
        key: 'key',
        type: 'secret',
        label: 'API key',
        required: true,
        env: ['TOAS_QWEN_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY']
      }
    ],

    processing: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'qwen3-asr-flash' }
      ],
      capabilities: capabilitiesFor('qwen3-asr-flash')
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []

    if (role !== 'processing') {
      issues.push({
        path: 'refine.provider',
        code: 'unsupported-role',
        message: `Qwen supports primary processing only, not ${role}`
      })
      return { config: null, capabilities: null, issues }
    }

    if (!secretPresence.key) {
      issues.push({
        path: `providers.qwen.key`,
        code: 'required',
        message: 'A Qwen (DashScope) API key is required'
      })
    }

    const endpoint = providerValues.endpoint
    if (!endpoint) {
      issues.push({
        path: 'providers.qwen.endpoint',
        code: 'required',
        message: 'A Qwen endpoint is required'
      })
    }

    const model = values.model
    if (!model?.trim()) {
      issues.push({
        path: 'values.model',
        code: 'required',
        message: 'A Qwen model is required'
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: null, issues }
    }

    return {
      config: {
        endpoint,
        model: model.trim()
      },
      capabilities: capabilitiesFor(model.trim()),
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw protocolError('configuration', 'A Qwen API key is required to create a processor')
    }
    return new QwenProcessor(config, secrets.key, runtime)
  }
}

function capabilitiesFor (model) {
  return MODEL_CAPABILITIES[model] ?? { context: [], integratedRefine: false }
}

class QwenProcessor {
  constructor (config, apiKey, runtime) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  async process ({ input, context, instructions, signal }) {
    if (input.kind !== 'audio') {
      throw protocolError('configuration', 'Qwen processing requires audio input')
    }
    if (instructions != null && instructions !== '') {
      // Qwen does not advertise integrated refine; the Kernel must never
      // route Refine Instructions here. Reaching this branch is a bug.
      throw protocolError('configuration', 'Qwen does not support integrated refine')
    }

    const messages = []

    // Context is Host-supplied and already capability-filtered by the Kernel.
    const systemParts = []
    if (context.terms?.length > 0) {
      systemParts.push(`技术讨论。常见术语：${context.terms.join(', ')}`)
    }
    if (context.passages?.length > 0) {
      systemParts.push(`背景信息：\n${context.passages.join('\n')}`)
    }
    if (systemParts.length > 0) {
      messages.push({
        role: 'system',
        content: [{ text: systemParts.join('\n\n') }]
      })
    }

    messages.push({
      role: 'user',
      content: [{ audio: `data:${input.mimeType};base64,${input.base64}` }]
    })

    const response = await this._send({
      model: this._config.model,
      input: { messages },
      parameters: { asr_options: { enable_itn: true } }
    }, signal)

    const text = extractDashScopeText(response)
    if (!text.trim()) {
      throw protocolError('no-text', 'No speech was recognized')
    }

    const finishReason = normalizeFinishReason(response?.output?.choices?.[0]?.finish_reason)

    return {
      text: text.trim(),
      model: this._config.model,
      finishReason,
      usage: normalizeUsage(response?.usage, {
        inputKey: 'input_tokens',
        outputKey: 'output_tokens'
      }),
      requestId: response?.request_id ?? null,
      responseId: null
    }
  }

  async _send (requestBody, signal) {
    const response = await this._runtime.transport.send({
      method: 'POST',
      url: this._config.endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`
      },
      body: encodeBody(requestBody)
    }, signal)

    if (signal?.aborted) { throw cancelledError() }

    if (response.status < 200 || response.status >= 300) {
      throw serviceErrorFromStatus(response.status, response.body, 'Qwen')
    }

    return decodeBody(response.body)
  }
}

function extractDashScopeText (data) {
  const content = data?.output?.choices?.[0]?.message?.content
  if (typeof content === 'string') { return content }
  if (Array.isArray(content)) {
    return content.map(part => part?.text).filter(Boolean).join('')
  }
  return ''
}
