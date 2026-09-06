// Shared Chat Completions protocol support.
// Wire shapes stay inside Provider modules; nothing here leaks to the Kernel domain.
// This module must not import GNOME/GI libraries.

import { cancelledError } from '../error.js'
import {
  decodeJsonBody,
  encodeJsonBody,
  serviceErrorFromHttpStatus
} from './http.js'

const decoder = new TextDecoder()

export class ChatCompletionsProcessor {
  constructor (provider, config, apiKey, runtime) {
    this._provider = provider
    this._label = provider.manifest.label
    this._config = config
    this._apiKey = apiKey
    this._runtime = runtime
  }

  _refineMessages ({ transcript, context, instructions }) {
    const prompt = this._provider.composeRefinePrompt({ transcript, context, instructions })
    return [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: prompt.userPrompt }
    ]
  }

  async _send (requestBody, signal) {
    const response = await this._runtime.transport.send({
      method: 'POST',
      url: normalizeChatCompletionsUrl(this._config.endpoint),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`
      },
      body: encodeJsonBody(requestBody)
    }, signal)

    if (signal?.aborted) { throw cancelledError() }

    if (response.status < 200 || response.status >= 300) {
      throw serviceErrorFromHttpStatus(
        response.status,
        this._label,
        chatCompletionsErrorDetail(response.body)
      )
    }

    return decodeJsonBody(response.body)
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

export function normalizeUsage (usage) {
  if (!usage) { return null }
  return {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null
  }
}

export function normalizeChatCompletionsUrl (endpoint) {
  const base = String(endpoint ?? '').replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) { return base }
  return `${base}/chat/completions`
}

function chatCompletionsErrorDetail (bodyBytes) {
  try {
    return JSON.parse(decoder.decode(bodyBytes))?.error?.message ?? ''
  } catch {
    return ''
  }
}
