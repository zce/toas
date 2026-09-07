// Refine failure policy end to end through the real registry.

import { process as kernelProcess, secretKey } from '../kernel/process.js'
import { providers } from '../kernel/providers/registry.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeTransport {
  constructor() {
    this.requests = []
  }

  async send(request) {
    this.requests.push({
      ...request,
      body: JSON.parse(decoder.decode(request.body))
    })
    return {
      status: 200,
      headers: {},
      body: encoder.encode(
        JSON.stringify({
          request_id: 'req-primary',
          output: {
            output: { sentence: { text: 'primary text' } },
            text: 'primary text'
          }
        })
      )
    }
  }
}

test('refine configuration failure obeys fallback policy', async () => {
  const transport = new FakeTransport()
  const result = await kernelProcess({
    config: {
      primary: {
        provider: 'qwen',
        values: { model: 'fun-asr-flash-2026-06-15' }
      },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'Polish the transcript.',
        onError: 'fallback'
      }
    },
    audio: {
      kind: 'audio',
      base64: 'ZmFrZS1hdWRpbw==',
      mimeType: 'audio/wav',
      durationMs: 1000
    },
    context: { text: '' },
    secrets: {
      [secretKey('qwen', 'key')]: 'qwen-secret'
    },
    runtime: {
      transport,
      clock: { now: () => 0 }
    },
    signal: null,
    providers
  })

  expectEqual(transport.requests.length, 1)
  expectEqual(result.text, 'primary text')
  expectEqual(result.trace.length, 2)
  expectEqual(result.trace[0].status, 'ok')
  expectEqual(result.trace[1].provider, 'mimo')
  expectEqual(result.trace[1].status, 'error')
  expectEqual(result.warning.type, 'refine-failed')
  expectEqual(result.warning.provider, 'mimo')
  expectTruthy(result.warning.message.includes('API key'))
})

await run()
