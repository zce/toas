// Cross-provider Processor behavior: shared status classification,
// cancellation handling, and malformed-response errors.

import { doubaoProvider } from '../kernel/providers/doubao.js'
import { mimoProvider } from '../kernel/providers/mimo.js'
import { openaiCompatibleProvider, openaiProvider } from '../kernel/providers/openai.js'
import { qwenProvider } from '../kernel/providers/qwen.js'
import { expectEqual, run, test } from './harness.js'

const encoder = new TextEncoder()
const AUDIO = {
  kind: 'audio',
  base64: 'UklGRg==',
  mimeType: 'audio/wav',
  durationMs: 1000
}

function encodeBody(value) {
  return encoder.encode(JSON.stringify(value))
}

function createProcessor({ provider, providerValues, values, transport }) {
  const resolved = provider.resolve({
    providerValues,
    values,
    secretPresence: { key: true }
  })
  expectEqual(resolved.issues, [])
  return provider.create(resolved.config, { key: 'secret' }, { transport })
}

function processorCases(transport) {
  return [
    {
      label: 'Qwen',
      processor: createProcessor({
        provider: qwenProvider,
        providerValues: {},
        values: { model: 'qwen3-asr-flash' },
        transport
      }),
      input: AUDIO
    },
    {
      label: 'Doubao',
      processor: createProcessor({
        provider: doubaoProvider,
        providerValues: { endpoint: 'https://example.test' },
        values: { model: 'volc.bigasr.auc_turbo' },
        transport
      }),
      input: AUDIO
    },
    {
      label: 'MiMo',
      processor: createProcessor({
        provider: mimoProvider,
        providerValues: { endpoint: 'https://example.test/v1' },
        values: { model: 'mimo-v2.6-flash' },
        transport
      }),
      input: { kind: 'text', text: 'hello' }
    },
    {
      label: 'OpenAI',
      processor: createProcessor({
        provider: openaiProvider,
        providerValues: { endpoint: 'https://example.test/v1' },
        values: { model: 'gpt-4o-mini' },
        transport
      }),
      input: { kind: 'text', text: 'hello' }
    },
    {
      label: 'OpenAI-compatible',
      processor: createProcessor({
        provider: openaiCompatibleProvider,
        providerValues: { endpoint: 'https://example.test/v1' },
        values: { model: 'custom-model' },
        transport
      }),
      input: { kind: 'text', text: 'hello' }
    }
  ]
}

async function processError(processor, input, signal = null) {
  try {
    await processor.process({
      input,
      context: { text: '' },
      instructions: '',
      signal
    })
  } catch (error) {
    return error
  }
  return null
}

test('remote processors share standard HTTP status classification', async () => {
  const transport = {
    async send() {
      return {
        status: 429,
        headers: {},
        body: encodeBody({ error: { message: 'slow down' } })
      }
    }
  }

  for (const { label, processor, input } of processorCases(transport)) {
    const error = await processError(processor, input)
    expectEqual(error?.category, 'rate-limited', `${label} category`)
    expectEqual(error?.status, 429, `${label} status`)
    expectEqual(error?.message.includes('slow down'), true, `${label} detail`)
  }
})

test('remote processors preserve cancellation after transport returns', async () => {
  const transport = {
    async send(_request, signal) {
      signal.aborted = true
      return { status: 500, headers: {}, body: encodeBody({}) }
    }
  }

  for (const { label, processor, input } of processorCases(transport)) {
    const signal = { aborted: false }
    const error = await processError(processor, input, signal)
    expectEqual(error?.category, 'cancelled', `${label} category`)
  }
})

test('remote processors reject malformed JSON responses consistently', async () => {
  const transport = {
    async send() {
      return {
        status: 200,
        headers: { 'x-api-status-code': '20000000' },
        body: encoder.encode('{not-json')
      }
    }
  }

  for (const { label, processor, input } of processorCases(transport)) {
    const error = await processError(processor, input)
    expectEqual(error?.category, 'invalid-response', `${label} category`)
  }
})

test('MiMo Refine disables thinking by default and exposes provider overrides', async () => {
  async function requestFor(values) {
    let requestBody = null
    const transport = {
      async send(request) {
        requestBody = JSON.parse(new TextDecoder().decode(request.body))
        return {
          status: 200,
          headers: {},
          body: encodeBody({ choices: [{ message: { content: 'refined' } }] })
        }
      }
    }
    const processor = createProcessor({
      provider: mimoProvider,
      providerValues: { endpoint: 'https://example.test/v1' },
      values: { model: 'mimo-v2.6-flash', ...values },
      transport
    })
    await processor.process({
      input: { kind: 'text', text: 'hello' },
      context: { text: '' },
      instructions: '',
      signal: null
    })
    return requestBody
  }

  expectEqual((await requestFor({})).thinking, { type: 'disabled' })
  expectEqual(Object.hasOwn(await requestFor({ thinking: 'default' }), 'thinking'), false)
})

test('MiMo transcription does not receive Refine thinking settings', async () => {
  let requestBody = null
  const transport = {
    async send(request) {
      requestBody = JSON.parse(new TextDecoder().decode(request.body))
      return {
        status: 200,
        headers: {},
        body: encodeBody({ choices: [{ message: { content: 'recognized' } }] })
      }
    }
  }
  const processor = createProcessor({
    provider: mimoProvider,
    providerValues: { endpoint: 'https://example.test/v1' },
    values: { model: 'mimo-v2.5-asr', thinking: 'off' },
    transport
  })
  await processor.process({
    input: AUDIO,
    context: { text: '' },
    instructions: '',
    signal: null
  })
  expectEqual(Object.hasOwn(requestBody, 'thinking'), false)
})

test('OpenAI Refine disables reasoning only for models that support none', async () => {
  async function requestFor(model, thinking = 'off') {
    let requestBody = null
    const transport = {
      async send(request) {
        requestBody = JSON.parse(new TextDecoder().decode(request.body))
        return {
          status: 200,
          headers: {},
          body: encodeBody({ choices: [{ message: { content: 'refined' } }] })
        }
      }
    }
    const resolved = openaiProvider.resolve({
      providerValues: { endpoint: 'https://example.test/v1' },
      values: { model, thinking },
      secretPresence: { key: true }
    })
    expectEqual(resolved.issues, [])
    const processor = openaiProvider.create(resolved.config, { key: 'secret' }, { transport })
    await processor.process({
      input: { kind: 'text', text: 'hello' },
      context: { text: '' },
      instructions: '',
      signal: null
    })
    return requestBody
  }

  for (const model of [
    'gpt-5.1',
    'gpt-5.2',
    'gpt-5.3',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.5',
    'gpt-5.5-2026-04-23',
    'gpt-5.6',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-6.1-terra',
    'gpt-6.1-terra-2026-06-01',
    'gpt-6-sol',
    'gpt-6-luna'
  ]) {
    expectEqual((await requestFor(model)).reasoning_effort, 'none', model)
  }
  for (const model of [
    'gpt-5.4-pro',
    'gpt-5.5-pro-2026-04-23',
    'gpt-5.6-cyber',
    'gpt-5.3-codex',
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-4o-mini'
  ]) {
    expectEqual(Object.hasOwn(await requestFor(model), 'reasoning_effort'), false, model)
  }
  expectEqual(Object.hasOwn(await requestFor('gpt-5.5', 'default'), 'reasoning_effort'), false)
})

test('OpenAI-compatible Refine maps Off to reasoning_effort none', async () => {
  async function requestFor(thinking) {
    let requestBody = null
    const transport = {
      async send(request) {
        requestBody = JSON.parse(new TextDecoder().decode(request.body))
        return {
          status: 200,
          headers: {},
          body: encodeBody({ choices: [{ message: { content: 'refined' } }] })
        }
      }
    }
    const resolved = openaiCompatibleProvider.resolve({
      providerValues: { endpoint: 'https://example.test/v1' },
      values: { model: 'custom-model', ...(thinking === undefined ? {} : { thinking }) },
      secretPresence: { key: true }
    })
    expectEqual(resolved.issues, [])
    const processor = openaiCompatibleProvider.create(resolved.config, { key: 'secret' }, { transport })
    await processor.process({
      input: { kind: 'text', text: 'hello' },
      context: { text: '' },
      instructions: '',
      signal: null
    })
    return requestBody
  }

  expectEqual(Object.hasOwn(await requestFor(), 'reasoning_effort'), false)
  expectEqual((await requestFor('off')).reasoning_effort, 'none')
  expectEqual(Object.hasOwn(await requestFor('default'), 'reasoning_effort'), false)
})

await run()
