// Qwen Provider: one synchronous DashScope Audio-ASR HTTP protocol.
// Model is a free-text identifier; unsupported protocol families fail upstream.

import { cancelledError, processingError, serviceErrorFromHttpStatus } from '../error.js'
import { Provider } from './provider.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const DEFAULT_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

class QwenProvider extends Provider {
  constructor() {
    super({
      id: 'qwen',
      manifest: {
        label: 'Qwen',
        fields: [
          {
            key: 'endpoint', type: 'url', label: 'Endpoint', default: '',
            env: ['TOAS_QWEN_ENDPOINT', 'DASHSCOPE_ENDPOINT']
          },
          {
            key: 'key', type: 'secret', label: 'API key', required: true,
            env: ['TOAS_QWEN_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY']
          }
        ],
        selectionFields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        support: { inputs: ['audio'], instructions: false },
        defaults: { audio: { model: 'qwen-audio-3.1-asr-flash' } }
      }
    })
  }

  resolveSelection({ providerValues, values }) {
    const endpoint = providerValues.endpoint?.trim() || DEFAULT_ENDPOINT
    const issues = []
    if (!endpoint.startsWith('https://')) {
      issues.push({
        path: 'providers.qwen.endpoint', code: 'invalid',
        message: 'Qwen endpoint must use https'
      })
    }
    return {
      input: 'audio',
      config: { endpoint, model: values.model?.trim() || '' },
      capabilities: { inputs: ['audio'], instructions: false, context: true },
      issues
    }
  }

  createProcessor(config, secrets, runtime) {
    return new QwenProcessor(this, config, secrets.key, runtime)
  }
}

export const qwenProvider = new QwenProvider()

class QwenProcessor {
  constructor(provider, config, apiKey, runtime) {
    this._provider = provider
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  async process({ input, context, signal }) {
    if (input.kind !== 'audio') {
      throw processingError('configuration', 'Qwen processing requires audio input')
    }

    const messages = []
    const contextText = this._provider.contextText(context)
    if (contextText.trim()) {
      messages.push({ role: 'user', content: [{ type: 'input_text', text: contextText }] })
    }
    messages.push({
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { data: `data:${input.mimeType};base64,${input.base64}` } }]
    })

    const response = await this._runtime.transport.send(
      {
        method: 'POST',
        url: this._config.endpoint,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`
        },
        body: encoder.encode(JSON.stringify({
          model: this._config.model,
          input: { messages },
          parameters: { format: input.mimeType === 'audio/mpeg' || input.mimeType === 'audio/mp3' ? 'mp3' : 'wav' }
        }))
      },
      signal
    )

    if (signal?.aborted) throw cancelledError()
    if (response.status < 200 || response.status >= 300) {
      const detail = errorDetail(response.body)
      if (detail.includes('ASR_RESPONSE_HAVE_NO_WORDS')) {
        throw processingError('no-text', 'No speech was recognized')
      }
      throw serviceErrorFromHttpStatus(response.status, 'Qwen', detail)
    }

    const data = decodeBody(response.body)
    const output = data?.output
    const text = output?.text ?? output?.output?.sentence?.text ??
      output?.sentence?.text ??
      (Array.isArray(output?.sentences) ? output.sentences.map(sentence => sentence?.text).filter(Boolean).join('') : '')
    if (typeof text !== 'string' || !text.trim()) {
      throw processingError('no-text', 'No speech was recognized')
    }
    return {
      text: text.trim(),
      model: this._config.model,
      usage: data?.usage
        ? {
            inputTokens: data.usage.input_tokens ?? null,
            outputTokens: data.usage.output_tokens ?? null,
            totalTokens: data.usage.total_tokens ?? null
          }
        : null,
      requestId: data?.request_id ?? null,
      responseId: null
    }
  }
}

function decodeBody(bytes) {
  if (!bytes?.length) throw processingError('invalid-response', 'The service returned an empty body')
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw processingError('invalid-response', 'The service returned invalid JSON')
  }
}

function errorDetail(bytes) {
  try {
    const response = JSON.parse(decoder.decode(bytes))
    const code = response?.code ?? response?.error?.code ?? ''
    const message = response?.message ?? response?.error?.message ?? ''
    return [code, message].filter(Boolean).join(' ').slice(0, 500)
  } catch {
    return ''
  }
}
