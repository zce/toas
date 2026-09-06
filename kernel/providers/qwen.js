// Qwen Provider (DashScope, HTTP non-realtime ASR).
// Supported models use explicit protocol mappings because their request and
// response envelopes differ. Unknown models are rejected rather than guessed.
// This module must not import GNOME/GI libraries.

import { Provider } from './provider.js'
import {
  encodeBody,
  decodeBody,
  normalizeUsage,
  serviceErrorFromStatus,
  processingError,
  cancelledError
} from './chat-completions.js'

const MODEL_SHAPES = {
  'qwen-audio-3.0-asr-flash': { capabilities: audioCapabilities(), protocol: 'asr3' },
  'fun-asr-flash-2026-06-15': { capabilities: audioCapabilities(), protocol: 'asr3' },
  'qwen3-asr-flash-2026-02-10': { capabilities: audioCapabilities(), protocol: 'compat' },
  // Kept for configurations saved before the versioned id existed.
  'qwen3-asr-flash': { capabilities: audioCapabilities(), protocol: 'multimodal' }
}

const ENDPOINTS = {
  asr3: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  multimodal: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  compat: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
}

class QwenProvider extends Provider {
  constructor () {
    super({
      id: 'qwen',
      manifest: {
        label: 'Qwen',
        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Endpoint',
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
        selectionFields: [
          {
            key: 'model',
            type: 'string',
            label: 'Model',
            required: true,
            choices: [
              { value: 'fun-asr-flash-2026-06-15', label: 'fun-asr-flash-2026-06-15' },
              { value: 'qwen-audio-3.0-asr-flash', label: 'qwen-audio-3.0-asr-flash' },
              { value: 'qwen3-asr-flash-2026-02-10', label: 'qwen3-asr-flash-2026-02-10' },
              { value: 'qwen3-asr-flash', label: 'qwen3-asr-flash · legacy' }
            ]
          }
        ],
        support: { inputs: ['audio'], instructions: false },
        defaults: { audio: { model: 'fun-asr-flash-2026-06-15' } }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = this.requiredIssues({ providerValues, values, secretPresence })
    const endpoint = providerValues.endpoint?.trim() || ''
    if (endpoint && !endpoint.startsWith('https://')) {
      issues.push({
        path: 'providers.qwen.endpoint',
        code: 'invalid',
        message: 'Qwen endpoint must use https'
      })
    }

    const model = values.model?.trim()
    const shape = model ? MODEL_SHAPES[model] : null
    if (model && !shape) {
      issues.push({
        path: 'values.model',
        code: 'unsupported',
        message: `Unsupported Qwen model: ${model}`
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: shape?.capabilities ?? null, issues }
    }

    return {
      config: {
        endpoint: endpoint || ENDPOINTS[shape.protocol],
        model
      },
      capabilities: shape.capabilities,
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'Qwen API key is required to create a processor')
    }
    return new QwenProcessor(config, secrets.key, runtime, MODEL_SHAPES[config.model])
  }
}

export const qwenProvider = new QwenProvider()

function audioCapabilities () {
  return { inputs: ['audio'], instructions: false, context: true }
}

class QwenProcessor {
  constructor (config, apiKey, runtime, shape) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
    this._shape = shape
  }

  async process ({ input, context, signal }) {
    if (input.kind !== 'audio') {
      throw processingError('configuration', 'Qwen processing requires audio input')
    }

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
      const messages = []
      if (contextText) {
        if (protocol === 'asr3') {
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

    return {
      text: text.trim(),
      model: this._config.model,
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
      const detail = safeErrorDetail(response.body)
      if (detail === 'ASR_RESPONSE_HAVE_NO_WORDS') {
        throw processingError('no-text', 'No speech was recognized')
      }
      throw serviceErrorFromStatus(response.status, response.body, 'Qwen')
    }

    return decodeBody(response.body)
  }
}

function safeErrorDetail (bodyBytes) {
  try {
    return JSON.parse(new TextDecoder().decode(bodyBytes))?.message ?? ''
  } catch {
    return ''
  }
}

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
