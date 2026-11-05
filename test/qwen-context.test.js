// Qwen's one synchronous Audio-ASR protocol accepts user-provided model IDs.

import { qwenProvider } from '../kernel/providers/qwen.js'
import { expectEqual, run, test } from './harness.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const AUDIO = { kind: 'audio', mimeType: 'audio/wav', base64: 'UklGRg==', durationMs: 1000 }
const CONTEXT = '  Names: MagicDoor, Payabli.  '

function resolve(model = 'qwen-audio-3.1-asr-flash') {
  return qwenProvider.resolve({
    providerValues: { endpoint: '' },
    values: { model },
    secretPresence: { key: true }
  })
}

async function send({ model, context = CONTEXT, response = { output: { text: 'ok' }, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }, status = 200 }) {
  const resolved = resolve(model)
  expectEqual(resolved.issues, [])
  let request
  const processor = qwenProvider.create(resolved.config, { key: 'secret' }, {
    transport: {
      async send(value) {
        request = { ...value, body: JSON.parse(decoder.decode(value.body)) }
        return { status, headers: {}, body: encoder.encode(JSON.stringify(response)) }
      }
    }
  })
  let result = null, error = null
  try { result = await processor.process({ input: AUDIO, context: { text: context }, signal: null }) }
  catch (caught) { error = caught }
  return { request, result, error }
}

test('Qwen has one Audio-ASR endpoint and input_audio envelope', async () => {
  const { request, result } = await send({})
  expectEqual(request.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  expectEqual(request.body.model, 'qwen-audio-3.1-asr-flash')
  expectEqual(request.headers['X-DashScope-SSE'], 'disable')
  expectEqual(request.body.parameters, { format: 'wav' })
  expectEqual(request.body.input.messages, [
    { role: 'user', content: [{ type: 'input_text', text: CONTEXT }] },
    { role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,UklGRg==' } }] }
  ])
  expectEqual(result.text, 'ok')
  expectEqual(result.usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })
})

test('Qwen accepts unlisted model IDs without guessing another protocol', async () => {
  const { request, result } = await send({ model: 'future-synchronous-asr', context: '' })
  expectEqual(request.body.model, 'future-synchronous-asr')
  expectEqual(request.body.input.messages.length, 1)
  expectEqual(request.body.input.messages[0].content[0].type, 'input_audio')
  expectEqual(result.text, 'ok')
})

test('Qwen native output.sentence and output.text are both accepted', async () => {
  expectEqual((await send({ response: { output: { sentence: { text: 'sentence' } } } })).result.text, 'sentence')
  expectEqual((await send({ response: { output: { text: 'full text' } } })).result.text, 'full text')
  expectEqual((await send({ response: { output: { sentences: [{ text: 'one' }, { text: 'two' }] } } })).result.text, 'onetwo')
  expectEqual((await send({ response: { output: { output: { sentences: [{ text: 'nested' }] } } } })).result.text, 'nested')
})

test('Qwen treats documented silence as no-text but preserves other service errors', async () => {
  const silence = await send({
    status: 400,
    response: { code: 'CLIENT_ERROR', message: 'ASR_RESPONSE_HAVE_NO_WORDS' }
  })
  expectEqual(silence.error?.category, 'no-text')
  const quota = await send({
    status: 403,
    response: { code: 'AllocationQuota.FreeTierOnly', message: 'Free quota exhausted' }
  })
  expectEqual(quota.error?.status, 403)
  expectEqual(quota.error?.category, 'quota')
  expectEqual(quota.error?.message.includes('Free Quota Only'), true)
  const forbidden = await send({ status: 403, response: { code: 'PermissionDenied', message: 'Access denied' } })
  expectEqual(forbidden.error?.category, 'authentication')
})

await run()
