// Qwen Provider (DashScope, HTTP non-realtime ASR).
// Primary processing only; separate refine is not offered because the
// verified ASR mappings have no tested text-refine implementation.
//
// Three verified model/protocol pairs (live-tested 2026-09-05):
// - qwen-audio-3.0-asr-flash, fun-asr-flash-2026-06-15:
//     DashScope multimodal-generation, input_audio parts, parameters.format,
//     nested output.output.sentence envelope (no choices). Context rides as
//     an input_text part before the audio. Audio 3.0 also accepts
//     language_hints; inline hot words are deliberately not exposed.
// - qwen3-asr-flash-2026-02-10 (and the bare qwen3-asr-flash alias):
//     OpenAI-compatible /compatible-mode/v1/chat/completions, choices
//     envelope, system-message context, asr_options.enable_itn extension.
//
// Context is free text the user composed and is delivered verbatim.
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
const MODEL_SHAPES = {
  'qwen-audio-3.0-asr-flash': { capabilities: { context: true, integratedRefine: false }, protocol: 'asr3' },
  'fun-asr-flash-2026-06-15': { capabilities: { context: true, integratedRefine: false }, protocol: 'asr3' },
  'qwen3-asr-flash-2026-02-10': { capabilities: { context: true, integratedRefine: false }, protocol: 'compat' },
  // Alias kept for configurations saved before the versioned id existed.
  'qwen3-asr-flash': { capabilities: { context: true, integratedRefine: false }, protocol: 'multimodal' }
}

// Official endpoints per protocol. An explicit endpoint override wins over
// these; verified live 2026-09-05.
const ENDPOINTS = {
  asr3: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  multimodal: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  compat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
}

function endpointIssues (endpoint) {
  const issues = []
  const value = String(endpoint).trim()
  if (!value.startsWith('https://')) {
    issues.push({
      path: 'providers.qwen.endpoint',
      code: 'invalid',
      message: 'A Qwen endpoint must use https'
    })
  }
  return issues
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
        // Empty lets the Provider route by model protocol: both official
        // endpoints below are verified live; an explicit override wins.
        default: '',
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
        { key: 'model', type: 'string', label: 'Model', required: true, default: 'qwen-audio-3.0-asr-flash' }
      ],
      capabilities: modelShapeFor('qwen-audio-3.0-asr-flash').capabilities
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
    if (endpoint) {
      issues.push(...endpointIssues(endpoint))
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

    const shape = modelShapeFor(model.trim())

    return {
      config: {
        endpoint: endpoint || ENDPOINTS[shape.protocol],
        model: model.trim()
      },
      capabilities: shape.capabilities,
      issues: []
    }
  },

  create (role, config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'A Qwen API key is required to create a processor')
    }
    return new QwenProcessor(config, secrets.key, runtime, modelShapeFor(config.model))
  }
}

function modelShapeFor (model) {
  // Unknown models stay conservative: no Context, no integrated refine, and
  // the default protocol shape. Capability is never guessed.
  return MODEL_SHAPES[model] ??
    { capabilities: { context: false, integratedRefine: false }, protocol: 'multimodal' }
}

class QwenProcessor {
  constructor (config, apiKey, runtime, shape) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
    this._shape = shape
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

    // Context is Host-supplied free text the user composed; it is delivered
    // verbatim so the user's own phrasing biases recognition as intended.
    const contextText = context.text?.trim() || null
    const audioDataUri = `data:${input.mimeType};base64,${input.base64}`
    const protocol = this._shape.protocol

    let response
    if (protocol === 'compat') {
      const messages = []
      if (contextText) {
        messages.push({ role: 'system', content: contextText })
      }
      messages.push({
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: audioDataUri } }]
      })
      response = await this._send({
        model: this._config.model,
        messages,
        stream: false,
        asr_options: { enable_itn: true }
      }, signal)
    } else {
      // asr3 (audio-3.0 / fun-asr) and legacy multimodal share the
      // DashScope native envelope; the context part differs.
      const messages = []
      if (contextText) {
        if (protocol === 'asr3') {
          // Verified shape: input_text part ahead of the audio, so the bias
          // text precedes what it biases.
          messages.push({ role: 'user', content: [{ type: 'input_text', text: contextText }] })
        } else {
          messages.push({ role: 'system', content: [{ text: contextText }] })
        }
      }
      messages.push({
        role: 'user',
        content: protocol === 'asr3'
          ? [{ type: 'input_audio', input_audio: { data: audioDataUri } }]
          : [{ audio: audioDataUri }]
      })
      response = await this._send({
        model: this._config.model,
        input: { messages },
        parameters: protocol === 'asr3'
          ? { format: 'wav' }
          : { asr_options: { enable_itn: true } }
      }, signal)
    }

    const text = extractQwenText(response, protocol)
    if (!text.trim()) {
      throw processingError('no-text', 'No speech was recognized')
    }

    const finishReason = protocol === 'compat'
      ? normalizeFinishReason(response?.choices?.[0]?.finish_reason)
      : normalizeFinishReason(
          protocol === 'asr3' ? null : response?.output?.choices?.[0]?.finish_reason
        )

    return {
      text: text.trim(),
      model: this._config.model,
      finishReason,
      usage: normalizeUsage(
        protocol === 'asr3' ? null : response?.usage,
        { inputKey: 'input_tokens', outputKey: 'output_tokens' }
      ),
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

// Verified response envelopes:
// - compat (qwen3-asr-flash-*): choices[0].message.content (OpenAI shape)
// - multimodal (qwen3-asr-flash alias): flat output.choices[0].message.content
// - asr3 (audio-3.0 / fun-asr): nested output.output.sentence.text or
//   output.output.sentences[].text — no choices, per the API reference
function extractQwenText (data, protocol) {
  if (protocol === 'asr3') {
    const inner = data?.output?.output
    if (typeof inner?.sentence?.text === 'string') { return inner.sentence.text }
    if (Array.isArray(inner?.sentences)) {
      return inner.sentences.map(s => s?.text).filter(Boolean).join('')
    }
    if (typeof data?.output?.text === 'string') { return data.output.text }
    return ''
  }

  if (protocol === 'compat') {
    const content = data?.choices?.[0]?.message?.content
    if (typeof content === 'string') { return content }
    if (Array.isArray(content)) {
      return content.map(part => part?.text).filter(Boolean).join('')
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
