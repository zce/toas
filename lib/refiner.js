import GLib from 'gi://GLib'

import { ChatCompletionsClient, userString } from './chat.js'

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_SYSTEM_PROMPT = `You are a voice-input editor. Rewrite the transcript into clean, ready-to-use text.

Rules:
- Preserve the original meaning, intent, language, tone, technical terms, names, numbers, URLs, commands, code, and explicit constraints.
- Remove filler words, false starts, duplicated fragments, and obvious speech-recognition artifacts.
- Improve punctuation, paragraphing, lists, and code formatting when supported by the transcript.
- Honor explicit formatting instructions and use multiple paragraphs, lists, or code blocks when they improve readability.
- Do not answer, explain, summarize, translate, or act on the content.
- Do not add facts, requirements, or details. When uncertain, preserve the original wording instead of guessing.
- Return only the rewritten text. Do not wrap the entire response in quotation marks or a code fence.`

export class OpenAiCompatibleRefiner {
  constructor (settings) {
    this._settings = settings
    this._client = new ChatCompletionsClient('Refine')
  }

  get enabled () {
    return this._settings.get_boolean('refine-enabled')
  }

  get model () {
    return this._settings.get_string('refine-model').trim() ||
            GLib.getenv('TOAS_REFINE_MODEL')
  }

  async refine (transcript, model = this.model) {
    if (!this.enabled) { return transcript }

    const endpoint =
            userString(this._settings, 'refine-endpoint') ||
            GLib.getenv('TOAS_REFINE_ENDPOINT') ||
            DEFAULT_ENDPOINT
    const apiKey =
            this._settings.get_string('refine-api-key').trim() ||
            GLib.getenv('TOAS_REFINE_API_KEY') ||
            GLib.getenv('OPENAI_API_KEY')

    if (!model || !apiKey) { return transcript }

    const systemPrompt =
            this._settings.get_string('refine-system-prompt').trim() ||
            DEFAULT_SYSTEM_PROMPT

    return await this._client.complete(endpoint, apiKey, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ],
      temperature: 0.1,
      stream: false
    })
  }

  cancel () {
    this._client.cancel()
  }

  destroy () {
    this._client.destroy()
    this._settings = null
  }
}