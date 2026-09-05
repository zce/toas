// Soup HTTP transport for the GNOME Host. Owns actual I/O, cancellation,
// timeout, DNS/TLS/proxy via Soup defaults, and byte-safe reads. Never knows
// anything about Provider payloads.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

// Minimal cancellation signal for processing attempts.
//
// GJS does not provide AbortController/AbortSignal, so the Host carries its
// own signal with the tiny surface the Kernel and HttpTransport rely on:
// `aborted`, `abort()`, addEventListener/removeEventListener('abort').
// The composition root creates one per attempt; cancelling or destroying the
// orchestrator aborts it.

export class AttemptSignal {
  constructor () {
    this._aborted = false
    this._listeners = []
  }

  get aborted () {
    return this._aborted
  }

  abort () {
    if (this._aborted) { return }
    this._aborted = true
    for (const listener of this._listeners.splice(0)) {
      listener()
    }
  }

  addEventListener (_type, listener) {
    if (this._aborted) {
      listener()
      return
    }
    this._listeners.push(listener)
  }

  removeEventListener (_type, listener) {
    const index = this._listeners.indexOf(listener)
    if (index >= 0) { this._listeners.splice(index, 1) }
  }
}

// Whole-response API, matching the verified production client: promisified
// Soup covers send and complete body read, including on HTTP error statuses.
Gio._promisify(
  Soup.Session.prototype,
  'send_and_read_async',
  'send_and_read_finish'
)

export class SoupHttpTransport {
  constructor ({ timeoutMs = 120000 } = {}) {
    this._session = new Soup.Session()
    this._timeoutMs = timeoutMs
  }

  /**
   * Sends a portable HTTP request and returns a portable response.
   *
   * @param {{method: string, url: string, headers: Object, body: Uint8Array}} request
   * @param {AbortSignal} signal
   * @returns {Promise<{status: number, headers: Object, body: Uint8Array}>}
   */
  async send (request, signal) {
    const message = Soup.Message.new(request.method, request.url)
    if (!message) {
      throw transportError('network', `Invalid request URL: ${request.url}`)
    }

    for (const [key, value] of Object.entries(request.headers || {})) {
      message.get_request_headers().append(key, String(value))
    }

    if (request.body) {
      // Content-Type is a request property, not transport policy.
      const contentType = request.headers?.['Content-Type'] ?? null
      message.set_request_body_from_bytes(
        contentType,
        GLib.Bytes.new(request.body)
      )
    }

    const cancellable = new Gio.Cancellable()
    let timedOut = false
    let timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._timeoutMs,
      () => {
        timeoutId = 0
        timedOut = true
        cancellable.cancel()
        return GLib.SOURCE_REMOVE
      }
    )

    const onAbort = () => cancellable.cancel()
    signal?.addEventListener?.('abort', onAbort)

    try {
      const bytes = await this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable
      )

      if (signal?.aborted) {
        throw transportError('cancelled', 'Request was cancelled')
      }
      if (timedOut) {
        throw transportError('timeout', 'Request timed out')
      }

      const headers = {}
      message.get_response_headers().foreach((name, value) => {
        headers[String(name).toLowerCase()] = String(value)
      })

      const body = bytes.get_data() ?? new Uint8Array(0)

      return { status: message.get_status(), headers, body }
    } catch (err) {
      if (signal?.aborted) {
        throw transportError('cancelled', 'Request was cancelled')
      }
      if (timedOut) {
        throw transportError('timeout', 'Request timed out')
      }
      if (err.category) { throw err }
      throw transportError('network', safeTransportMessage(err))
    } finally {
      if (timeoutId) { GLib.source_remove(timeoutId) }
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  destroy () {
    this._session?.abort()
    this._session = null
  }
}

function transportError (category, message) {
  const err = new Error(message)
  err.category = category
  return err
}

// GIO error messages can carry provider URLs; bound them and strip stack-like
// noise. The category is what matters to callers.
function safeTransportMessage (err) {
  const message = String(err?.message ?? err)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}
