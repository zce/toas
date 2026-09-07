// Qwen Context wire encodings across its verified protocols.

import { qwenProvider } from '../kernel/providers/qwen.js'
import { expectEqual, run, test } from './harness.js'

const AUDIO = {
  kind: 'audio',
  mimeType: 'audio/wav',
  base64: 'UklGRg==',
  durationMs: 1000
}
const CONTEXT = '  Names: MagicDoor, Payabli.  '

test('Qwen ASR3 maps toas Context to input_text recognition context', async () => {
  const request = await sentRequest('fun-asr-flash-2026-06-15', asr3Response())
  expectEqual(request.input.messages[0], {
    role: 'user',
    content: [{ type: 'input_text', text: CONTEXT }]
  })
})

test('Qwen compatible ASR maps the same Context to its documented system text field', async () => {
  const request = await sentRequest('qwen3-asr-flash-2026-02-10', compatResponse())
  expectEqual(request.messages[0], { role: 'system', content: CONTEXT })
})

test('Qwen legacy multimodal ASR maps the same Context to system content parts', async () => {
  const request = await sentRequest('qwen3-asr-flash', multimodalResponse())
  expectEqual(request.input.messages[0], {
    role: 'system',
    content: [{ text: CONTEXT }]
  })
})

test('Qwen omits recognition context when toas Context is empty', async () => {
  const request = await sentRequest('fun-asr-flash-2026-06-15', asr3Response(), '')
  expectEqual(request.input.messages.length, 1)
  expectEqual(request.input.messages[0].content[0].type, 'input_audio')
})

async function sentRequest(model, responseBody, context = CONTEXT) {
  const resolved = qwenProvider.resolve({
    providerValues: { endpoint: '' },
    values: { model },
    secretPresence: { key: true }
  })
  expectEqual(resolved.issues, [])

  const transport = new FakeTransport(responseBody)
  const processor = qwenProvider.create(
    resolved.config,
    { key: 'secret' },
    {
      transport,
      clock: { now: () => 0 }
    }
  )

  await processor.process({
    input: AUDIO,
    context: { text: context },
    instructions: null,
    signal: null
  })

  return transport.requests[0].body
}

class FakeTransport {
  constructor(responseBody) {
    this.responseBody = responseBody
    this.requests = []
  }

  async send(request) {
    this.requests.push({ ...request, body: decodeBody(request.body) })
    return {
      status: 200,
      headers: {},
      body: encodeBody(this.responseBody)
    }
  }
}

function asr3Response() {
  return { output: { output: { sentence: { text: 'ok' } } } }
}

function compatResponse() {
  return { choices: [{ message: { content: 'ok' } }] }
}

function multimodalResponse() {
  return { output: { choices: [{ message: { content: 'ok' } }] } }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
function encodeBody(value) {
  return encoder.encode(JSON.stringify(value))
}
function decodeBody(bytes) {
  return JSON.parse(decoder.decode(bytes))
}

await run()
