// Live transport regression checks against a local libsoup server.
// These lock the Soup wiring that once broke every real request: the
// promisified whole-response call, cancellation through AttemptSignal, and
// the timeout classification. Network-free except for 127.0.0.1.

import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'
import System from 'system'

import { AttemptSignal, SoupHttpTransport } from '../host/transport.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PORT = 47655

let passed = 0
let failed = 0
function check (label, condition, detail = '') {
  if (condition) {
    passed++
    print(`ok - ${label}`)
  } else {
    failed++
    print(`FAIL - ${label}${detail ? `: ${detail}` : ''}`)
  }
}

// A libsoup server that answers POST /ok immediately with a fixed body, and
// holds POST /hang without answering (to drive timeout and cancellation).
function startServer () {
  const server = new Soup.Server()
  server.add_handler('/ok', (_server, message) => {
    const body = encoder.encode('ok')
    message.set_status(200, null)
    message.set_response('text/plain', Soup.MemoryUse.COPY, body)
  })
  server.add_handler('/hang', (_server, message) => {
    // Pause forever: the request stays open so timeout/cancellation can
    // interrupt a genuinely in-flight request.
    message.pause()
  })
  server.listen_local(PORT, Soup.ServerListenOptions.IPV4_ONLY)
  return server
}

const loop = GLib.MainLoop.new(null, false)

async function run () {
  const server = startServer()
  const base = `http://127.0.0.1:${PORT}`

  // 1. Successful round trip through the promisified whole-response call.
  {
    const transport = new SoupHttpTransport({ timeoutMs: 5000 })
    try {
      const res = await transport.send({
        method: 'POST',
        url: `${base}/ok`,
        headers: { 'Content-Type': 'application/json' },
        body: encoder.encode('{}')
      }, null)
      check('whole-response round trip returns status and body',
        res.status === 200 && decoder.decode(res.body) === 'ok',
        `status=${res.status}`)
    } catch (e) {
      check('whole-response round trip returns status and body', false, e.message)
    }
    transport.destroy()
  }

  // 2. A request that outlives its timeout is a timeout failure, never a
  //    Soup call-arity or crash error.
  {
    const transport = new SoupHttpTransport({ timeoutMs: 400 })
    const startedAt = GLib.get_monotonic_time()
    try {
      await transport.send({
        method: 'POST',
        url: `${base}/hang`,
        headers: {},
        body: encoder.encode('{}')
      }, null)
      check('timeout is classified as timeout', false, 'unexpected success')
    } catch (e) {
      const elapsedMs = (GLib.get_monotonic_time() - startedAt) / 1000
      check('timeout is classified as timeout',
        e.category === 'timeout' && elapsedMs < 3000,
        `category=${e.category} elapsed=${Math.round(elapsedMs)}ms message="${e.message}"`)
    }
    transport.destroy()
  }

  // 3. AttemptSignal abort mid-request cancels the HTTP request promptly.
  {
    const transport = new SoupHttpTransport({ timeoutMs: 10000 })
    const signal = new AttemptSignal()
    const startedAt = GLib.get_monotonic_time()
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => { signal.abort(); return GLib.SOURCE_REMOVE })

    try {
      await transport.send({
        method: 'POST',
        url: `${base}/hang`,
        headers: {},
        body: encoder.encode('{}')
      }, signal)
      check('signal abort cancels the request', false, 'unexpected success')
    } catch (e) {
      const elapsedMs = (GLib.get_monotonic_time() - startedAt) / 1000
      check('signal abort cancels the request',
        e.category === 'cancelled' && elapsedMs < 3000,
        `category=${e.category} elapsed=${Math.round(elapsedMs)}ms`)
    }
    transport.destroy()
  }

  server.disconnect()
  print(`\n${passed}/${passed + failed} passed`)
  loop.quit()
  if (failed > 0) { System.exit(1) }
}

run().catch(e => {
  print(`FATAL: ${e.message}\n${e.stack}`)
  loop.quit()
  System.exit(1)
})
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => { print('TIMEOUT'); loop.quit(); System.exit(1); return GLib.SOURCE_REMOVE })
loop.run()
