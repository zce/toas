import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

Gio._promisify(
  Soup.Session.prototype,
  'send_and_read_async',
  'send_and_read_finish'
)

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
const REQUEST_TIMEOUT_MS = 120000

export class OpenAiCompatibleRefiner {
  constructor (settings) {
    this._settings = settings
    this._session = new Soup.Session()
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
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript }
      ],
      temperature: 0.1,
      stream: false
    })

    const message = Soup.Message.new('POST', endpoint)
    message.get_request_headers().append('Authorization', `Bearer ${apiKey}`)
    message.set_request_body_from_bytes(
      'application/json',
      new GLib.Bytes(new TextEncoder().encode(body))
    )

    const bytes = await this._send(message)
    const responseText = new TextDecoder().decode(bytes.get_data())
    const status = message.get_status()

    if (status < 200 || status >= 300) { throw new Error(`Refine HTTP ${status}: ${responseText.slice(0, 240)}`) }

    let response
    try {
      response = JSON.parse(responseText)
    } catch {
      throw new Error('Refine returned invalid JSON')
    }

    const result = response?.choices?.[0]?.message?.content?.trim()
    if (!result) { throw new Error('Refine returned no text') }

    return result
  }

  async _send (message) {
    const cancellable = new Gio.Cancellable()
    this._activeCancellable = cancellable
    let timedOut = false
    let timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      REQUEST_TIMEOUT_MS,
      () => {
        timeoutId = 0
        timedOut = true
        cancellable.cancel()
        return GLib.SOURCE_REMOVE
      }
    )

    try {
      return await this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable
      )
    } catch (error) {
      if (timedOut) { throw new Error('Refine request timed out') }
      throw error
    } finally {
      if (timeoutId) { GLib.source_remove(timeoutId) }
      if (this._activeCancellable === cancellable) { this._activeCancellable = null }
    }
  }

  cancel () {
    this._activeCancellable?.cancel()
  }

  destroy () {
    this.cancel()
    this._session?.abort()
    this._session = null
    this._settings = null
  }
}

function userString (settings, key) {
  return settings.get_user_value(key)
    ? settings.get_string(key).trim()
    : ''
}
