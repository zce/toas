import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

Gio._promisify(
  Soup.Session.prototype,
  'send_and_read_async',
  'send_and_read_finish'
)

const REQUEST_TIMEOUT_MS = 120000

// Shared client for OpenAI-style Chat Completions endpoints. Transcription
// and Refine both send one non-streaming JSON request and read the assistant
// text from choices[0].message.content. The label prefixes request errors.
export class ChatCompletionsClient {
  constructor (label) {
    this._label = label
    this._session = new Soup.Session()
  }

  async complete (endpoint, apiKey, body) {
    const message = Soup.Message.new('POST', endpoint)
    message.get_request_headers().append('Authorization', `Bearer ${apiKey}`)
    message.set_request_body_from_bytes(
      'application/json',
      new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body)))
    )

    const bytes = await this._send(message)
    const responseText = new TextDecoder().decode(bytes.get_data())
    const status = message.get_status()

    if (status < 200 || status >= 300) { throw new Error(`${this._label} HTTP ${status}: ${responseText.slice(0, 240)}`) }

    let response
    try {
      response = JSON.parse(responseText)
    } catch {
      throw new Error(`${this._label} returned invalid JSON`)
    }

    const content = response?.choices?.[0]?.message?.content?.trim()
    if (!content) { throw new Error(`${this._label} returned no text`) }

    return {
      content,
      finishReason: response?.choices?.[0]?.finish_reason ?? null,
      usage: response?.usage ?? null,
      model: response?.model ?? null,
      id: response?.id ?? null
    }
  }

  cancel () {
    this._activeCancellable?.cancel()
  }

  destroy () {
    this.cancel()
    this._session?.abort()
    this._session = null
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
      if (timedOut) { throw new Error(`${this._label} request timed out`) }
      throw error
    } finally {
      if (timeoutId) { GLib.source_remove(timeoutId) }
      if (this._activeCancellable === cancellable) { this._activeCancellable = null }
    }
  }
}

// Returns a user-configured string value, or '' when the key still holds
// its schema default. Lets callers treat an unset key differently from an
// empty user override when falling back to environment variables.
export function userOverride (settings, key) {
  return settings.get_user_value(key)
    ? settings.get_string(key).trim()
    : ''
}