// Qwen Provider (DashScope multimodal-generation, HTTP non-realtime).
// Primary processing only; separate refine is not offered because the
// verified ASR mapping has no tested text-refine implementation.
// Context is passed verbatim as the system message text.
// This module must not import GNOME/GI libraries.

import {
  encodeBody,
  decodeBody,
  extractContent,
  normalizeFinishReason,
  normalizeUsage,
  serviceErrorFromStatus,
  processingError,
  cancelledError
} from './chat-helpers.js'

// Explicit, tested capability mapping. Unknown models stay conservative:
// no Context, no integrated refine. Capability is never guessed from a
// model-name pattern or from generic prompt acceptance.
//
// qwen3-asr-flash dialect: multimodal-generation with a bare audio part and
// a flat output.choices envelope.
// qwen-audio-3.0-asr-flash dialect: input_audio parts, parameters.format,
// and a nested output.output.sentence envelope. Verified 2026-09-05.
const MODEL_CAPABILITIES = {
  'qwen3-asr-flash': { context: true, integratedRefine: false, dialect: 'multimodal' },
  'qwen-audio-3.0-asr-flash': { context: true, integratedRefine: false, dialect: 'asr3' }
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

    primary: {
      fields: [
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'qwen3-asr-flash' }
      ],
      capabilities: capabilitiesFor('qwen3-asr-flash')
    }
  },

  resolve ({ role, providerValues, values, secretPresence }) {
    const issues = []

    if (role !== 'primary') {
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
      throw processingError('configuration', 'A Qwen API key is required to create a processor')
    }
    return new QwenProcessor(config, secrets.key, runtime, capabilitiesFor(config.model))
  }
}

function capabilitiesFor (model) {
  return MODEL_CAPABILITIES[model] ?? { context: false, integratedRefine: false, dialect: null }
}

class QwenProcessor {
  constructor (config, apiKey, runtime, capabilities) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
    this._capabilities = capabilities
  }

  async process ({ input, context, instructions, signal }) {
    if (input.kind !== 'audio') {
      throw processingError('configuration', 'Qwen processing requires audio input')
    }
    if (instructions != null && instructions !== '') {
      // Qwen does not advertise integrated refine; the Kernel must never
      // route Refine Instructions here. Reaching this branch is a bug.
      throw processingError('configuration', 'Qwen does not support integrated refine')
    }

    // Context is Host-supplied free text the user composed; it is passed
    // verbatim so the user's own phrasing biases recognition as intended.
    const systemText = context.text?.trim() || null
    const audioPart = this._capabilities.dialect === 'asr3'
      ? { type: 'input_audio', input_audio: { data: `data:${input.mimeType};base64,${input.base64}` } }
      : { audio: `data:${input.mimeType};base64,${input.base64}` }

    const messages = []
    if (systemText) {
      messages.push({ role: 'system', content: [{ text: systemText }] })
    }
    messages.push({ role: 'user', content: [audioPart] })

    const requestBody = {
      model: this._config.model,
      input: { messages },
      parameters: this._capabilities.dialect === 'asr3'
        ? { format: 'wav' }
        : { asr_options: { enable_itn: true } }
    }

    const response = await this._send(requestBody, signal)

    const text = extractDashScopeText(response, this._capabilities.dialect)
    if (!text.trim()) {
      throw processingError('no-text', 'No speech was recognized')
    }

    const finishReason = normalizeFinishReason(
      this._capabilities.dialect === 'asr3'
        ? null
        : response?.output?.choices?.[0]?.finish_reason
    )

    return {
      text: text.trim(),
      model: this._config.model,
      finishReason,
      usage: normalizeUsage(this._capabilities.dialect === 'asr3' ? null : response?.usage, {
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

// Two verified response envelopes share one endpoint family:
// - multimodal (qwen3-asr-flash): flat output.choices[0].message.content
// - asr3 (qwen-audio-3.0-asr-flash): nested output.output.sentence(s).text
function extractDashScopeText (data, dialect) {
  if (dialect === 'asr3') {
    const inner = data?.output?.output
    if (typeof inner?.sentence?.text === 'string') { return inner.sentence.text }
    if (Array.isArray(inner?.sentences)) {
      return inner.sentences.map(s => s?.text).filter(Boolean).join('')
    }
    return ''
  }

  const content = data?.output?.choices?.[0]?.message?.content
  if (typeof content === 'string') { return content }
  if (Array.isArray(content)) {
    return content.map(part => part?.text).filter(Boolean).join('')
  }
  return ''
}
