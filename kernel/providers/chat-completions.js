// Shared Chat Completions protocol support.
// Wire shapes stay inside Provider modules; nothing here leaks to the Kernel domain.
// This module must not import GNOME/GI libraries.

import { cancelledError, processingError } from '../error.js'

export { cancelledError, processingError } from '../error.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class ChatCompletionsProcessor {
  constructor (label, config, apiKey, runtime) {
    this._label = label
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
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

export function encodeBody (value) {
  return encoder.encode(JSON.stringify(value))
}

export function decodeBody (bytes) {
  if (!bytes || bytes.length === 0) {
    throw processingError('invalid-response', 'The service returned an empty body')
  }
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch {
    throw processingError('invalid-response', 'The service returned invalid JSON')
  }
}

export function extractContent (data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') { return content }
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('')
  }
  return ''
}

export function normalizeUsage (usage, { inputKey = 'prompt_tokens', outputKey = 'completion_tokens' } = {}) {
  if (!usage) { return null }
  return {
    inputTokens: usage[inputKey] ?? null,
    outputTokens: usage[outputKey] ?? null,
    totalTokens: usage.total_tokens ?? null
  }
}

export function normalizeChatCompletionsUrl (endpoint) {
  const base = String(endpoint ?? '').replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) { return base }
  return `${base}/chat/completions`
}

export function serviceErrorFromStatus (status, bodyBytes, label) {
  let detail = ''
  try {
    const parsed = JSON.parse(decoder.decode(bodyBytes))
    detail = parsed?.error?.message ?? ''
  } catch {
    // Body stays private; the category and label are enough for the user.
  }
  if (detail.length > 200) { detail = detail.slice(0, 200) }

  let category = 'service'
  let message = `${label} service error (HTTP ${status})`

  if (status === 401 || status === 403) {
    category = 'authentication'
    message = `${label} rejected the API key (HTTP ${status})`
  } else if (status === 404) {
    category = 'not-found'
    message = `${label} endpoint or model not found (HTTP 404)`
  } else if (status === 429) {
    category = 'rate-limited'
    message = `${label} rate limit exceeded (HTTP 429)`
  } else if (status >= 500) {
    category = 'service'
    message = `${label} service unavailable (HTTP ${status})`
  }

  if (detail) { message = `${message}: ${detail}` }
  return processingError(category, message, status)
}
