// Soup HTTP transport for the GNOME Host. Owns actual I/O, cancellation,
// timeout, DNS/TLS/proxy via Soup defaults, and byte-safe reads. Never knows
// anything about Provider payloads.

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

Gio._promisify(
  Gio.InputStream.prototype,
  'read_bytes_async',
  'read_bytes_finish'
)

const CHUNK_SIZE = 64 * 1024

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

    const onAbort = () => cancellable.cancel()
    signal?.addEventListener?.('abort', onAbort)

    const timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this._timeoutMs,
      () => {
        timedOut = true
        cancellable.cancel()
        return GLib.SOURCE_REMOVE
      }
    )

    try {
      const inputStream = await this._session.send_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable
      )
      const body = await this._readAll(inputStream, cancellable)

      if (signal?.aborted) {
        throw transportError('cancelled', 'Request was cancelled')
      }
      if (timedOut || cancellable.is_cancelled()) {
        throw transportError('timeout', 'Request timed out')
      }

      const headers = {}
      message.get_response_headers().foreach((name, value) => {
        headers[String(name).toLowerCase()] = String(value)
      })

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
      GLib.source_remove(timeoutId)
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  async _readAll (stream, cancellable) {
    const chunks = []

    try {
      while (true) {
        const bytes = await stream.read_bytes_async(
          CHUNK_SIZE,
          GLib.PRIORITY_DEFAULT,
          cancellable
        )
        if (bytes.get_size() === 0) { break }
        chunks.push(bytes.get_data())
      }
    } finally {
      try { stream.close(null) } catch {
        // Best effort during cancellation.
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
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
