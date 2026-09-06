// Kernel behavior tests for the runtime-agnostic processing seam.
// No network and no GNOME runtime are required.

import { process as kernelProcess, filterContext, normalizeContext, secretKey } from '../kernel/process.js'
import { providers as registry } from '../kernel/providers/registry.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const providers = new Map(registry)

function runKernel (args) {
  return kernelProcess({ ...args, providers })
}

const AUDIO = { kind: 'audio', base64: 'aW5zZXJ0LWF1ZGlv', mimeType: 'audio/wav', durationMs: 1000 }
const CONTEXT = { text: '技术讨论。术语表：useEffect, usePaymentMethods' }

class FakeTransport {
  constructor ({ responses = [] } = {}) {
    this.requests = []
    this._responses = [...responses]
  }

  async send (request, signal) {
    this.requests.push({ ...request, body: decodeBody(request.body) })
    if (signal?.aborted) {
      throw Object.assign(new Error('cancelled'), { category: 'cancelled' })
    }
    const next = this._responses.shift()
    if (!next) { throw new Error('FakeTransport: no queued response') }
    if (next.throw) { throw next.throw }
    return next
  }
}

function chatResponse (text, extra = {}) {
  return {
    status: 200,
    headers: {},
    body: encodeBody({
      id: 'resp-1',
      model: extra.model ?? 'fake-model',
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      ...extra
    })
  }
}

function asr3Response (text, extra = {}) {
  return {
    status: 200,
    headers: {},
    body: encodeBody({
      request_id: 'req-asr3',
      output: {
        output: { sentence: { text } },
        text
      },
      ...extra
    })
  }
}

function dashscopeResponse (text, extra = {}) {
  return {
    status: 200,
    headers: {},
    body: encodeBody({
      request_id: 'req-1',
      output: {
        choices: [{ message: { content: [{ text }] }, finish_reason: 'stop' }]
      },
      usage: { input_tokens: 10, output_tokens: 5 },
      ...extra
    })
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
function encodeBody (value) { return encoder.encode(JSON.stringify(value)) }
function decodeBody (bytes) {
  try { return JSON.parse(decoder.decode(bytes)) } catch { return null }
}

function runtimeFor (transport) {
  return { transport, clock: { now: () => 0 } }
}

function baseConfig ({ provider = 'qwen', refine = { enabled: false } } = {}) {
  return {
    primary: { provider, values: { model: 'qwen3-asr-flash' } },
    refine
  }
}

const SECRETS = {
  [secretKey('qwen', 'key')]: 'qwen-secret',
  [secretKey('mimo', 'key')]: 'mimo-secret',
  [secretKey('openai', 'key')]: 'openai-secret',
  [secretKey('openai-compatible', 'key')]: 'compatible-secret'
}

test('qwen only: disabled refine makes exactly one call and one trace entry', async () => {
  const transport = new FakeTransport({ responses: [dashscopeResponse('hello world')] })
  const result = await runKernel({
    config: baseConfig({ provider: 'qwen' }),
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 1)
  expectEqual(transport.requests[0].url,
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  expectEqual(result.text, 'hello world')
  expectEqual(result.trace.length, 1)
  expectEqual(result.trace[0].role, 'primary')
  expectEqual(result.trace[0].provider, 'qwen')
  expectEqual(result.trace[0].input, 'audio')
  expectEqual(result.warning, null)
})

test('qwen to mimo: refine runs the configured provider in order', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('raw transcript'),
      chatResponse('refined text', { model: 'mimo-text' })
    ]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'Refine without changing meaning.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 2)
  expectTruthy(transport.requests[0].url.includes('dashscope.aliyuncs.com'))
  expectTruthy(transport.requests[1].url.includes('token-plan-cn.xiaomimimo.com'))
  expectEqual(result.text, 'refined text')
  expectEqual(result.trace.length, 2)
  expectEqual(result.trace[0].provider, 'qwen')
  expectEqual(result.trace[1].provider, 'mimo')
  expectEqual(result.trace[1].input, 'text')
  expectEqual(result.warning, null)

  expectTruthy(transport.requests[0].body.input.messages.every(m =>
    JSON.stringify(m).indexOf('Refine without changing meaning.') === -1))
  expectTruthy(JSON.stringify(transport.requests[1].body).includes('Refine without changing meaning.'))
})

test('mimo refine endpoint that already carries the path is never double-appended', async () => {
  const transport = new FakeTransport({
    responses: [dashscopeResponse('raw transcript'), chatResponse('refined text')]
  })
  await runKernel({
    config: {
      providers: { mimo: { endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions' } },
      primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'Refine without changing meaning.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests[1].url, 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
})

test('mimo refine endpoint with trailing slashes gets a single path appended', async () => {
  const transport = new FakeTransport({
    responses: [dashscopeResponse('raw transcript'), chatResponse('refined text')]
  })
  await runKernel({
    config: {
      providers: { mimo: { endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/' } },
      primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'Refine without changing meaning.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests[1].url, 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
})

test('mimo to openai: cross-provider composition has no special casing', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('mimo primary'), chatResponse('openai refined')]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'mimo', values: { model: 'mimo-v2.5-asr', language: 'auto' } },
      refine: {
        enabled: true,
        provider: 'openai',
        values: { model: 'gpt-4o-mini' },
        instructions: 'Polish.',
        onError: 'abort'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 2)
  expectEqual(transport.requests[0].url, 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
  expectEqual(transport.requests[1].url, 'https://api.openai.com/v1/chat/completions')
  expectEqual(result.trace.map(t => t.provider), ['mimo', 'openai'])
})

test('mimo to mimo: one shared credential source, independent models', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('primary out'), chatResponse('refine out')]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'mimo', values: { model: 'mimo-v2.5-asr' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'Clean up.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 2)
  expectEqual(transport.requests[0].headers.Authorization, 'Bearer mimo-secret')
  expectEqual(transport.requests[1].headers.Authorization, 'Bearer mimo-secret')
  expectEqual(transport.requests[0].body.model, 'mimo-v2.5-asr')
  expectEqual(transport.requests[1].body.model, 'mimo-v2.5')
  expectEqual(result.trace[0].model, 'mimo-v2.5-asr')
  expectEqual(result.trace[1].model, 'mimo-v2.5')
})

test('empty context is valid', async () => {
  const transport = new FakeTransport({ responses: [dashscopeResponse('ok')] })
  const result = await runKernel({
    config: baseConfig({ provider: 'qwen' }),
    audio: AUDIO,
    context: { terms: [], passages: [] },
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(result.trace[0].context, [])
  expectEqual(transport.requests[0].body.input.messages.length, 1)
})

test('refine fallback returns primary text with warning and failed trace', async () => {
  const transport = new FakeTransport({
    responses: [dashscopeResponse('primary text'), { status: 500, headers: {}, body: encodeBody({}) }]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'x',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(result.text, 'primary text')
  expectEqual(result.trace.length, 2)
  expectEqual(result.trace[0].status, 'ok')
  expectEqual(result.trace[1].status, 'error')
  expectEqual(result.warning.type, 'refine-failed')
  expectEqual(result.warning.provider, 'mimo')
})

test('refine abort fails the whole attempt', async () => {
  const transport = new FakeTransport({
    responses: [dashscopeResponse('primary text'), { status: 500, headers: {}, body: encodeBody({}) }]
  })
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          provider: 'mimo',
          values: { model: 'mimo-v2.5' },
          instructions: 'x',
          onError: 'abort'
        }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'service')
})

test('primary failure fails the attempt with zero refine calls', async () => {
  const transport = new FakeTransport({
    responses: [{ status: 401, headers: {}, body: encodeBody({}) }]
  })
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          provider: 'mimo',
          values: { model: 'mimo-v2.5' },
          instructions: 'x',
          onError: 'fallback'
        }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'authentication')
  expectEqual(transport.requests.length, 1)
})

test('invalid primary config makes zero calls before any I/O', async () => {
  const transport = new FakeTransport()
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: {} },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'configuration')
  expectEqual(transport.requests.length, 0)
})

test('missing primary secret fails resolution without calls', async () => {
  const transport = new FakeTransport({ responses: [dashscopeResponse('x')] })
  let threw = null
  try {
    await runKernel({
      config: baseConfig({ provider: 'qwen' }),
      audio: AUDIO,
      context: CONTEXT,
      secrets: {},
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'configuration')
  expectEqual(transport.requests.length, 0)
})

test('no-text primary response is a safe failure category', async () => {
  const transport = new FakeTransport({ responses: [dashscopeResponse('')] })
  let threw = null
  try {
    await runKernel({
      config: baseConfig({ provider: 'qwen' }),
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'no-text')
})

test('ASR silence answer (400, no words) is no-text, not a service error', async () => {
  const transport = new FakeTransport({
    responses: [{
      status: 400,
      headers: {},
      body: encodeBody({
        request_id: 'req-400',
        code: 'CLIENT_ERROR',
        message: 'ASR_RESPONSE_HAVE_NO_WORDS'
      })
    }]
  })
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen-audio-3.0-asr-flash' } },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'no-text')
})

test('other 400 answers stay service-category errors', async () => {
  const transport = new FakeTransport({
    responses: [{
      status: 400,
      headers: {},
      body: encodeBody({ code: 'CLIENT_ERROR', message: 'InvalidParameter' })
    }]
  })
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen-audio-3.0-asr-flash' } },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'service')
})

class AbortNow {
  constructor () { this.aborted = true }
}

test('cancelled signal aborts before any call', async () => {
  const transport = new FakeTransport()
  let threw = null
  try {
    await runKernel({
      config: baseConfig({ provider: 'qwen' }),
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: new AbortNow()
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'cancelled')
  expectEqual(transport.requests.length, 0)
})

class CancelOnSend {
  constructor () {
    this.aborted = false
    this._listeners = []
  }
  abort () {
    this.aborted = true
    for (const listener of this._listeners.splice(0)) { listener() }
  }
  addEventListener (_type, listener) { this._listeners.push(listener) }
  removeEventListener (_type, listener) {
    const index = this._listeners.indexOf(listener)
    if (index >= 0) { this._listeners.splice(index, 1) }
  }
}

test('cancel during refine never converts into a fallback warning', async () => {
  const signal = new CancelOnSend()
  const transport = new FakeTransport({
    responses: [dashscopeResponse('primary text'), chatResponse('never used')]
  })
  const originalSend = transport.send.bind(transport)
  transport.send = async (request, sig) => {
    if (transport.requests.length === 1) { signal.abort() }
    return originalSend(request, sig)
  }

  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          provider: 'mimo',
          values: { model: 'mimo-v2.5' },
          instructions: 'x',
          onError: 'fallback'
        }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal
    })
  } catch (error) {
    threw = error
  }

  expectTruthy(threw)
  expectEqual(threw.category, 'cancelled')
})

test('context is delivered verbatim only to roles that support it', async () => {
  const transport = new FakeTransport({ responses: [chatResponse('p'), chatResponse('r')] })
  await runKernel({
    config: {
      primary: { provider: 'mimo', values: { model: 'mimo-v2.5-asr' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'x',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  const primaryBody = transport.requests[0].body
  expectTruthy(primaryBody.messages.every(message => !JSON.stringify(message).includes('useEffect')))

  const refineBody = transport.requests[1].body
  const systemMessages = refineBody.messages.filter(message => message.role === 'system')
  expectEqual(systemMessages.length, 1)
  expectEqual(systemMessages[0].content, CONTEXT.text)
})

test('normalizeContext trims surrounding whitespace and accepts empty', () => {
  const snapshot = normalizeContext({ text: '  技术讨论。术语：useEffect  ' })
  expectEqual(snapshot.text, '技术讨论。术语：useEffect')
  expectEqual(normalizeContext({}).text, '')
  expectEqual(normalizeContext(null).text, '')
})

test('normalizeContext rejects non-string text', () => {
  let threw = null
  try { normalizeContext({ text: 42 }) } catch (error) { threw = error }
  expectEqual(threw.category, 'configuration')
})

test('filterContext passes text only to capabilities that allow it', () => {
  const allowed = filterContext(CONTEXT, { context: true })
  expectEqual(allowed.text, CONTEXT.text)

  const denied = filterContext(CONTEXT, { context: false })
  expectEqual(denied.text, '')

  const unspecified = filterContext(CONTEXT, {})
  expectEqual(unspecified.text, '')
})

test('trace and warnings never carry credentials or context contents', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('primary text'),
      { status: 500, headers: {}, body: encodeBody({ secret: 'leak' }) }
    ]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        provider: 'mimo',
        values: { model: 'mimo-v2.5' },
        instructions: 'confidential-instructions',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  const serialized = JSON.stringify(result)
  expectEqual(serialized.includes('qwen-secret'), false)
  expectEqual(serialized.includes('mimo-secret'), false)
  expectEqual(serialized.includes('usePaymentMethods'), false)
  expectEqual(serialized.includes('confidential-instructions'), false)
  expectEqual(serialized.includes('Bearer'), false)
})

test('provider behavior is identical through an interchangeable transport', async () => {
  class OtherTransport {
    constructor () { this.requests = [] }
    async send (request) {
      this.requests.push(request)
      return dashscopeResponse('same text')
    }
  }
  const transport = new OtherTransport()
  const result = await runKernel({
    config: baseConfig({ provider: 'qwen' }),
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: { transport, clock: { now: () => 0 } },
    signal: null
  })

  expectEqual(result.text, 'same text')
  expectEqual(transport.requests.length, 1)
})

test('qwen audio-3.0 and fun-asr route to the asr3 endpoint and context part', async () => {
  for (const model of ['qwen-audio-3.0-asr-flash', 'fun-asr-flash-2026-06-15']) {
    const transport = new FakeTransport({ responses: [asr3Response('asr3 text')] })
    const result = await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model } },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })

    expectEqual(transport.requests.length, 1)
    expectEqual(transport.requests[0].url,
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    const body = transport.requests[0].body
    expectEqual(body.input.messages.length, 2)
    expectEqual(body.input.messages[0].content[0].type, 'input_text')
    expectEqual(body.input.messages[0].content[0].text, CONTEXT.text)
    expectEqual(body.input.messages[1].content[0].type, 'input_audio')
    expectEqual(body.parameters.format, 'wav')
    expectEqual(result.text, 'asr3 text')
  }
})

test('qwen3 versioned model routes to the compatible-mode endpoint', async () => {
  const transport = new FakeTransport({
    responses: [{
      status: 200,
      headers: {},
      body: encodeBody({
        choices: [{ message: { content: 'compat text' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    }]
  })
  const result = await runKernel({
    config: {
      primary: {
        provider: 'qwen',
        values: { model: 'qwen3-asr-flash-2026-02-10' }
      },
      refine: { enabled: false }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 1)
  expectEqual(transport.requests[0].url,
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
  const body = transport.requests[0].body
  expectEqual(body.messages[0].role, 'system')
  expectEqual(body.messages[0].content, CONTEXT.text)
  expectEqual(body.messages[1].content[0].type, 'input_audio')
  expectEqual(body.asr_options.enable_itn, true)
  expectEqual(result.text, 'compat text')
})

test('unknown qwen models are rejected without guessing an invocation protocol', async () => {
  const transport = new FakeTransport()
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', values: { model: 'qwen-unknown-model' } },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) { threw = error }
  expectEqual(threw.category, 'configuration')
  expectEqual(transport.requests.length, 0)
})

test('resolved input capabilities, not Provider identity, decide product suitability', async () => {
  const transport = new FakeTransport()
  let threw = null
  try {
    await runKernel({
      config: {
        providers: {},
        primary: { provider: 'openai', values: { model: 'gpt-4o-mini' } },
        refine: { enabled: false }
      },
      audio: AUDIO,
      context: CONTEXT,
      secrets: SECRETS,
      runtime: runtimeFor(transport),
      signal: null
    })
  } catch (error) { threw = error }
  expectEqual(threw.category, 'configuration')
  expectEqual(threw.message.includes('primary audio processing'), true)
  expectEqual(transport.requests.length, 0)
})

await run()
