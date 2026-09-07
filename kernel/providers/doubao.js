// Doubao Provider: BigASR recording-file Flash over the Speech API.
//
// The selectable value below is the Speech Resource ID. It is deliberately
// kept distinct from the request body's model_name ("bigmodel").
//
// This module must not import GNOME/GI libraries.

import { cancelledError, processingError, serviceErrorFromHttpStatus } from '../error.js'
import { Provider } from './provider.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'

const MODEL_SHAPES = {
  'volc.bigasr.auc_turbo': {
    resourceId: 'volc.bigasr.auc_turbo',
    modelName: 'bigmodel',
    capabilities: audioCapabilities()
  }
}

class DoubaoProvider extends Provider {
  constructor() {
    super({
      id: 'doubao',
      manifest: {
        label: 'Doubao',
        fields: [
          {
            key: 'endpoint',
            type: 'url',
            label: 'Endpoint',
            required: true,
            default: FLASH_ENDPOINT,
            env: ['TOAS_DOUBAO_ENDPOINT', 'DOUBAO_ASR_ENDPOINT']
          },
          {
            key: 'key',
            type: 'secret',
            label: 'API key',
            required: true,
            env: ['TOAS_DOUBAO_API_KEY', 'DOUBAO_ASR_API_KEY']
          }
        ],
        selectionFields: [
          {
            key: 'model',
            type: 'string',
            label: 'Model',
            required: true,
            choices: [{ value: 'volc.bigasr.auc_turbo', label: 'BigASR Flash' }]
          }
        ],
        support: { inputs: ['audio'], instructions: false },
        defaults: { audio: { model: 'volc.bigasr.auc_turbo' } }
      }
    })
  }

  resolveSelection({ providerValues, values }) {
    const issues = []
    const endpoint = providerValues.endpoint?.trim()
    if (endpoint && !endpoint.startsWith('https://')) {
      issues.push({
        path: 'providers.doubao.endpoint',
        code: 'invalid',
        message: 'Doubao endpoint must use https'
      })
    }

    const { model, shape, issues: modelIssues } = this.resolveModelShape(values, MODEL_SHAPES)
    issues.push(...modelIssues)

    return {
      input: 'audio',
      config: shape
        ? {
            endpoint,
            model,
            resourceId: shape.resourceId,
            modelName: shape.modelName
          }
        : null,
      capabilities: shape?.capabilities ?? null,
      issues
    }
  }

  createProcessor(config, secrets, runtime) {
    return new DoubaoProcessor(this, config, secrets.key, runtime)
  }
}

export const doubaoProvider = new DoubaoProvider()

function audioCapabilities() {
  return { inputs: ['audio'], instructions: false, context: true }
}

class DoubaoProcessor {
  constructor(provider, config, apiKey, runtime) {
    this._provider = provider
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  // Success requires HTTP 200 plus the documented business status header
  // (x-api-status-code 20000000); anything else is a service error carrying
  // the provider's logid for troubleshooting.
  async process({ input, context, signal }) {
    if (input.kind !== 'audio') {
      throw processingError('configuration', 'Doubao processing requires audio input')
    }

    const contextText = this._provider.contextText(context)
    const request = {
      model_name: this._config.modelName,
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      enable_speaker_info: false
    }

    if (contextText.trim()) {
      request.corpus = {
        context: JSON.stringify({
          context_type: 'dialog_ctx',
          context_data: [{ text: contextText }]
        })
      }
    }

    const clientRequestId = createRequestId()
    const response = await this._runtime.transport.send(
      {
        method: 'POST',
        url: this._config.endpoint,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this._apiKey,
          'X-Api-Resource-Id': this._config.resourceId,
          'X-Api-Request-Id': clientRequestId,
          'X-Api-Sequence': '-1'
        },
        body: encodeBody({
          user: { uid: 'toas' },
          audio: { data: input.base64 },
          request
        })
      },
      signal
    )

    if (signal?.aborted) {
      throw cancelledError()
    }

    const logId = responseHeader(response.headers, 'x-tt-logid')

    if (response.status < 200 || response.status >= 300) {
      throw withLogId(serviceErrorFromHttpStatus(response.status, 'Doubao', doubaoHttpErrorDetail(response.body)), logId)
    }

    const statusCode = responseHeader(response.headers, 'x-api-status-code')
    if (!statusCode) {
      throw processingError('invalid-response', 'Doubao response is missing X-Api-Status-Code')
    }
    if (statusCode !== '20000000') {
      const message = safeHeader(responseHeader(response.headers, 'x-api-message'))
      const logSuffix = logId ? ` [logid ${safeHeader(logId)}]` : ''
      throw processingError('service', `Doubao service error (${safeHeader(statusCode)})${message ? `: ${message}` : ''}${logSuffix}`)
    }

    const data = decodeBody(response.body)
    const text = data?.result?.text
    if (typeof text !== 'string' || !text.trim()) {
      throw processingError('no-text', 'No speech was recognized')
    }

    return {
      text: text.trim(),
      model: this._config.model,
      usage: null,
      // Prefer the provider's troubleshooting id in Trace; fall back to the
      // UUID sent by the client if the response omits it.
      requestId: logId || clientRequestId,
      responseId: null
    }
  }
}

function encodeBody(value) {
  return encoder.encode(JSON.stringify(value))
}

function decodeBody(bytes) {
  if (!bytes || bytes.length === 0) {
    throw processingError('invalid-response', 'The service returned an empty body')
  }
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw processingError('invalid-response', 'The service returned invalid JSON')
  }
}

function doubaoHttpErrorDetail(bodyBytes) {
  try {
    return JSON.parse(decoder.decode(bodyBytes))?.error?.message ?? ''
  } catch {
    return ''
  }
}

function responseHeader(headers, name) {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) {
      return String(value)
    }
  }
  return ''
}

// Scrub control characters so hostile header values cannot smuggle newlines
// into notifications, history, or logs.
function safeHeader(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}]/gu, ' ')
    .trim()
    .slice(0, 120)
}

function withLogId(error, logId) {
  const safeLogId = safeHeader(logId)
  if (safeLogId) {
    error.message = `${error.message} [logid ${safeLogId}]`
  }
  return error
}

// RFC 4122 v4-shaped UUID for the X-Api-Request-Id header.
function createRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}
