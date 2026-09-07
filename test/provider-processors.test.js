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
        values: { model: 'mimo-v2.5' },
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

await run()
