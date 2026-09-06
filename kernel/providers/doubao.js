// Doubao Provider: BigASR recording-file Flash over the Speech API.
//
// The selectable value below is the Speech Resource ID. It is deliberately
// kept distinct from the request body's model_name ("bigmodel"). Seed-ASR 2.0
// is not routed through this endpoint: its documented recording-file API uses
// submit + query rather than Flash's single synchronous request.
//
// This module must not import GNOME/GI libraries.

import { Provider } from './provider.js'
import {
  encodeBody,
  decodeBody,
  serviceErrorFromStatus,
  processingError,
  cancelledError
} from './chat-completions.js'

const FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'

const MODEL_SHAPES = {
  'volc.bigasr.auc_turbo': {
    resourceId: 'volc.bigasr.auc_turbo',
    modelName: 'bigmodel',
    capabilities: audioCapabilities()
  }
}

class DoubaoProvider extends Provider {
  constructor () {
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
            label: 'Speech API key',
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
            choices: [
              { value: 'volc.bigasr.auc_turbo', label: 'BigASR Flash · enable volc.bigasr.auc_turbo first' }
            ]
          }
        ],
        support: { inputs: ['audio'], instructions: false },
        defaults: { audio: { model: 'volc.bigasr.auc_turbo' } }
      }
    })
  }

  resolve ({ providerValues, values, secretPresence }) {
    const issues = []

    if (!secretPresence.key) {
      issues.push({
        path: 'providers.doubao.key',
        code: 'required',
        message: 'A Doubao Speech API key is required'
      })
    }

    const endpoint = String(providerValues.endpoint ?? '').trim()
    if (!endpoint) {
      issues.push({
        path: 'providers.doubao.endpoint',
        code: 'required',
        message: 'A Doubao endpoint is required'
      })
    } else if (!endpoint.startsWith('https://')) {
      issues.push({
        path: 'providers.doubao.endpoint',
        code: 'invalid',
        message: 'A Doubao endpoint must use https'
      })
    }

    const model = values.model?.trim()
    if (!model) {
      issues.push({
        path: 'values.model',
        code: 'required',
        message: 'A Doubao model is required'
      })
    }

    const shape = model ? MODEL_SHAPES[model] : null
    if (model && !shape) {
      issues.push({
        path: 'values.model',
        code: 'unsupported',
        message: `Unsupported Doubao model: ${model}`
      })
    }

    if (issues.length > 0) {
      return { config: null, capabilities: shape?.capabilities ?? null, issues }
    }

    return {
      config: {
        endpoint,
        model,
        resourceId: shape.resourceId,
        modelName: shape.modelName
      },
      capabilities: shape.capabilities,
      issues: []
    }
  }

  create (config, secrets, runtime) {
    if (!secrets.key) {
      throw processingError('configuration', 'A Doubao Speech API key is required to create a processor')
    }
    return new DoubaoProcessor(config, secrets.key, runtime)
  }
}

export const doubaoProvider = new DoubaoProvider()

function audioCapabilities () {
  // Flash does not expose toas's free-text Context contract as a documented
  // inline request field. Keep Context off rather than guessing a hotword or
  // corpus shape. Refine stays a separate product step.
  return { inputs: ['audio'], instructions: false, context: false, integratedRefine: false }
}

class DoubaoProcessor {
  constructor (config, apiKey, runtime) {
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  async process ({ input, instructions, signal }) {
    if (input.kind !== 'audio') {
      throw processingError('configuration', 'Doubao processing requires audio input')
    }
    if (instructions != null && instructions !== '') {
      throw processingError('configuration', 'Doubao does not support integrated refine')
    }

    const clientRequestId = createRequestId()
    const response = await this._runtime.transport.send({
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
        // Doubao Flash expects raw Base64, not a data: URI.
        audio: { data: input.base64 },
        request: {
          model_name: this._config.modelName,
          enable_itn: true,
          enable_punc: true,
          // DDC can smooth spoken language and alter the literal transcript.
          // toas already has an explicit Refine step, so keep it disabled.
          enable_ddc: false,
          enable_speaker_info: false
        }
      })
    }, signal)

    if (signal?.aborted) { throw cancelledError() }

    const logId = responseHeader(response.headers, 'x-tt-logid')

    if (response.status < 200 || response.status >= 300) {
      throw withLogId(
        serviceErrorFromStatus(response.status, response.body, 'Doubao'),
        logId
      )
    }

    // HTTP 200 alone is not success for the Speech API. The documented
    // business-success code is 20000000 in X-Api-Status-Code.
    const statusCode = responseHeader(response.headers, 'x-api-status-code')
    if (!statusCode) {
      throw processingError('invalid-response', 'Doubao response is missing X-Api-Status-Code')
    }
    if (statusCode !== '20000000') {
      const message = safeHeader(responseHeader(response.headers, 'x-api-message'))
      const logSuffix = logId ? ` [logid ${safeHeader(logId)}]` : ''
      throw processingError(
        'service',
        `Doubao service error (${safeHeader(statusCode)})${message ? `: ${message}` : ''}${logSuffix}`
      )
    }

    const data = decodeBody(response.body)
    const text = data?.result?.text
    if (typeof text !== 'string' || !text.trim()) {
      throw processingError('no-text', 'No speech was recognized')
    }

    return {
      text: text.trim(),
      model: this._config.model,
      finishReason: null,
      usage: null,
      // Prefer the provider's troubleshooting id in Trace; fall back to the
      // UUID sent by the client if the response omits it.
      requestId: logId || clientRequestId,
      responseId: null
    }
  }
}

function responseHeader (headers, name) {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) { return String(value) }
  }
  return ''
}

function safeHeader (value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 120)
}

function withLogId (error, logId) {
  const safeLogId = safeHeader(logId)
  if (safeLogId) {
    error.message = `${error.message} [logid ${safeLogId}]`
  }
  return error
}

// X-Api-Request-Id is correlation-only, not a credential. A UUID-shaped
// random value is sufficient and keeps this Kernel module runtime-agnostic.
function createRequestId () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}
