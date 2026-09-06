import { doubaoProvider } from '../kernel/providers/doubao.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const AUDIO = {
  kind: 'audio',
  base64: 'UklGRg==',
  mimeType: 'audio/wav',
  durationMs: 1000
}

function encodeBody (value) {
  return encoder.encode(JSON.stringify(value))
}

function decodeBody (bytes) {
  return JSON.parse(decoder.decode(bytes))
}

function resolveDoubao ({ secret = true } = {}) {
  return doubaoProvider.resolve({
    providerValues: {
      endpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
    },
    values: { model: 'volc.bigasr.auc_turbo' },
    secretPresence: { key: secret }
  })
}

test('Doubao manifest exposes BigASR Flash as an audio-only selection', () => {
  const resolved = resolveDoubao()
  expectEqual(resolved.issues, [])
  expectEqual(resolved.config.model, 'volc.bigasr.auc_turbo')
  expectEqual(resolved.config.resourceId, 'volc.bigasr.auc_turbo')
  expectEqual(resolved.config.modelName, 'bigmodel')
  expectEqual(resolved.capabilities, {
    inputs: ['audio'],
    instructions: false,
    context: false
  })
})

test('Doubao requires its Speech API key before processor creation', () => {
  const resolved = resolveDoubao({ secret: false })
  expectTruthy(resolved.issues.some(issue => issue.path === 'providers.doubao.key'))
})

test('Doubao Flash sends the documented headers, raw Base64, and model_name', async () => {
  let request = null
  const transport = {
    async send (value) {
      request = value
      return {
        status: 200,
        headers: {
          'x-api-status-code': '20000000',
          'x-api-message': 'OK',
          'x-tt-logid': 'log-success'
        },
        body: encodeBody({ result: { text: '  hello world  ' } })
      }
    }
  }

  const resolved = resolveDoubao()
  const processor = doubaoProvider.create(resolved.config, { key: 'doubao-secret' }, { transport })
  const result = await processor.process({
    input: AUDIO,
    context: { text: 'must not be sent' },
    signal: null
  })

  expectEqual(request.method, 'POST')
  expectEqual(request.url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash')
  expectEqual(request.headers['X-Api-Key'], 'doubao-secret')
  expectEqual(request.headers['X-Api-Resource-Id'], 'volc.bigasr.auc_turbo')
  expectEqual(request.headers['X-Api-Sequence'], '-1')
  expectTruthy(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    request.headers['X-Api-Request-Id']
  ))

  const body = decodeBody(request.body)
  expectEqual(body.audio.data, AUDIO.base64)
  expectEqual(body.request.model_name, 'bigmodel')
  expectEqual(body.request.enable_itn, true)
  expectEqual(body.request.enable_punc, true)
  expectEqual(body.request.enable_ddc, false)
  expectEqual(JSON.stringify(body).includes('data:audio'), false)
  expectEqual(JSON.stringify(body).includes('must not be sent'), false)

  expectEqual(result.text, 'hello world')
  expectEqual(result.model, 'volc.bigasr.auc_turbo')
  expectEqual(result.requestId, 'log-success')
})

test('Doubao does not treat HTTP 200 as business success', async () => {
  const transport = {
    async send () {
      return {
        status: 200,
        headers: {
          'x-api-status-code': '45000000',
          'x-api-message': 'Bad request',
          'x-tt-logid': 'log-failure'
        },
        body: encodeBody({})
      }
    }
  }

  const resolved = resolveDoubao()
  const processor = doubaoProvider.create(resolved.config, { key: 'doubao-secret' }, { transport })
  let threw = null
  try {
    await processor.process({ input: AUDIO, signal: null })
  } catch (error) {
    threw = error
  }

  expectEqual(threw.category, 'service')
  expectTruthy(threw.message.includes('45000000'))
  expectTruthy(threw.message.includes('log-failure'))
})

test('Doubao requires the documented business status header', async () => {
  const transport = {
    async send () {
      return {
        status: 200,
        headers: {},
        body: encodeBody({ result: { text: 'text' } })
      }
    }
  }

  const resolved = resolveDoubao()
  const processor = doubaoProvider.create(resolved.config, { key: 'doubao-secret' }, { transport })
  let threw = null
  try {
    await processor.process({ input: AUDIO, signal: null })
  } catch (error) {
    threw = error
  }

  expectEqual(threw.category, 'invalid-response')
})

await run()
