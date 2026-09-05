// Kernel behavior tests: the runtime-agnostic `process` seam. These cover
// the ten acceptance scenarios from spec #22 using fake transports and the
// real registered Providers, plus the test-integrated Provider for the
// integrated-refine capability branch. No network, no GNOME.

import { process as kernelProcess, filterContext, normalizeContext, secretKey } from '../lib/kernel/process.js'
import { providers as registry } from '../lib/kernel/providers/registry.js'
import { testIntegratedProvider } from '../lib/kernel/providers/test-integrated.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

const providers = new Map(registry)
providers.set('test-integrated', testIntegratedProvider)

// Every kernelProcess call below passes this registry explicitly.
function runKernel (args) {
  return kernelProcess({ ...args, providers })
}

const AUDIO = { kind: 'audio', base64: 'aW5zZXJ0LWF1ZGlv', mimeType: 'audio/wav', durationMs: 1000 }
const CONTEXT = { text: '技术讨论。术语表：useEffect, usePaymentMethods' }

// Fake transport: records requests, returns queued responses per provider.
// Also counts calls so tests can assert exact physical call counts.
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

// DashScope response shape (qwen): output.choices[0].message.content.
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
    primary: { provider, endpoint: null, values: { model: 'qwen3-asr-flash' } },
    refine
  }
}

const SECRETS = {
  [secretKey('qwen', 'key')]: 'qwen-secret',
  [secretKey('mimo', 'key')]: 'mimo-secret',
  [secretKey('openai', 'key')]: 'openai-secret',
  [secretKey('openai-compatible', 'key')]: 'compatible-secret',
  [secretKey('test-integrated', 'key')]: 'test-secret'
}

// --- Acceptance 1: Qwen only -----------------------------------------------

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

// --- Acceptance 2: Qwen -> MiMo ----------------------------------------------

test('qwen to mimo: separate refine runs the configured provider in order', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('raw transcript'),
      chatResponse('refined text', { model: 'mimo-text' })
    ]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'mimo-text-model' },
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

  // Instructions reach only the refine request.
  expectTruthy(transport.requests[0].body.input.messages.every(m =>
    JSON.stringify(m).indexOf('Refine without changing meaning.') === -1))
  expectTruthy(JSON.stringify(transport.requests[1].body).includes('Refine without changing meaning.'))
})

// --- Acceptance 3: MiMo -> OpenAI ---------------------------------------------

test('mimo refine endpoint that already carries the path is never double-appended', async () => {
  // Endpoints copied from other tools or older versions may be full request
  // URLs; the provider must send to them exactly once.
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('raw transcript'),
      chatResponse('refined text')
    ]
  })
  await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
        values: { model: 'mimo-text-model' },
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
    responses: [
      dashscopeResponse('raw transcript'),
      chatResponse('refined text')
    ]
  })
  await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/',
        values: { model: 'mimo-text-model' },
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

test('mimo to openai: cross-provider composition with no special casing', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('mimo primary'), chatResponse('openai refined')]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'mimo', endpoint: null, values: { model: 'mimo-v2.5-asr', language: 'auto' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'openai',
        endpoint: null,
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

// --- Acceptance 4: MiMo -> MiMo shared config -----------------------------------

test('mimo to mimo: one shared credential source, independent models', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('primary out'), chatResponse('refine out')]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'mimo', endpoint: null, values: { model: 'mimo-v2.5-asr' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'mimo-text-model' },
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
  // Same credential for both calls: one shared secret set per provider.
  expectEqual(transport.requests[0].headers.Authorization, 'Bearer mimo-secret')
  expectEqual(transport.requests[1].headers.Authorization, 'Bearer mimo-secret')
  // Independent role models.
  expectEqual(transport.requests[0].body.model, 'mimo-v2.5-asr')
  expectEqual(transport.requests[1].body.model, 'mimo-text-model')
  expectEqual(result.trace[0].model, 'mimo-v2.5-asr')
  expectEqual(result.trace[1].model, 'mimo-text-model')
})

// --- Acceptance 5: Integrated refine, one call ----------------------------------

test('integrated refine on a capable provider makes exactly one call carrying instructions', async () => {
  const transport = new FakeTransport({ responses: [chatResponse('ignored')]  })
  const result = await runKernel({
    config: {
      primary: { provider: 'test-integrated', endpoint: null, values: { model: 'test-model' } },
      refine: {
        enabled: true,
        execution: 'integrated',
        instructions: 'Refine while transcribing.'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests.length, 0) // test provider does not use transport
  expectTruthy(result.text.includes('Refine while transcr'))
  expectTruthy(result.text.includes('[context present]'))
  expectEqual(result.trace.length, 1)
  expectEqual(result.trace[0].input, 'audio+instructions')
  expectEqual(result.trace[0].integratedRefine, true)
  expectEqual(result.trace[0].context, ['text'])
})

// --- Acceptance 6: Unsupported integrated rejected -------------------------------

test('integrated refine on an incapable provider fails validation with zero calls', async () => {
  const transport = new FakeTransport()
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
        refine: { enabled: true, execution: 'integrated', instructions: 'x' }
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
  expectEqual(threw.message.includes('integrated'), true)
  expectEqual(transport.requests.length, 0)
})

// --- Acceptance 7: Explicit separate is authoritative ----------------------------

test('explicit separate runs the second provider even when primary could integrate', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('primary text'), chatResponse('refined')]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'test-integrated', endpoint: null, values: { model: 'test-model' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'mimo-text-model' },
        instructions: 'Clean.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  // Two physical calls: the configured refine provider was not skipped even
  // though the primary advertises integrated refine.
  expectEqual(transport.requests.length, 1) // mimo refine (test-integrated primary needs no transport)
  expectEqual(result.trace.length, 2)
  expectEqual(result.trace[1].provider, 'mimo')
  expectEqual(result.trace[0].integratedRefine, false)
  expectEqual(result.trace[0].input, 'audio')
})

// --- Acceptance 10: Empty Context -------------------------------------------------

test('empty context is valid for every execution shape', async () => {
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

  // Integrated shape with empty context.
  const integrated = await runKernel({
    config: {
      primary: { provider: 'test-integrated', endpoint: null, values: { model: 'm' } },
      refine: { enabled: true, execution: 'integrated', instructions: 'x' }
    },
    audio: AUDIO,
    context: { terms: [], passages: [] },
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })
  expectEqual(integrated.trace[0].context, [])
})

// --- Failure policies --------------------------------------------------------

test('separate refine fallback returns primary text with warning and failed trace', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('primary text'),
      { status: 500, headers: {}, body: encodeBody({}) }
    ]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'm' },
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

test('separate refine abort fails the whole attempt', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('primary text'),
      { status: 500, headers: {}, body: encodeBody({}) }
    ]
  })
  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          execution: 'separate',
          provider: 'mimo',
          endpoint: null,
          values: { model: 'm' },
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
        primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          execution: 'separate',
          provider: 'mimo',
          endpoint: null,
          values: { model: 'm' },
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
        primary: { provider: 'qwen', endpoint: null, values: {} },
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

// --- Cancellation -------------------------------------------------------------

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
    for (const l of this._listeners.splice(0)) l()
  }
  addEventListener (_t, l) { this._listeners.push(l) }
  removeEventListener (_t, l) {
    const i = this._listeners.indexOf(l)
    if (i >= 0) this._listeners.splice(i, 1)
  }
}

test('cancel during refine never converts into a fallback warning', async () => {
  const signal = new CancelOnSend()
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('primary text'),
      chatResponse('never used', {})
    ]
  })
  // Abort as soon as the second (refine) request is dispatched.
  const originalSend = transport.send.bind(transport)
  transport.send = async (request, sig) => {
    // Abort just as the refine (second) request is dispatched.
    if (transport.requests.length === 1) { signal.abort() }
    return originalSend(request, sig)
  }

  let threw = null
  try {
    await runKernel({
      config: {
        primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
        refine: {
          enabled: true,
          execution: 'separate',
          provider: 'mimo',
          endpoint: null,
          values: { model: 'm' },
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

// --- Context contract -----------------------------------------------------------

test('context is delivered verbatim only to roles that support it', async () => {
  const transport = new FakeTransport({
    responses: [chatResponse('p'), chatResponse('r')]
  })
  await runKernel({
    config: {
      // MiMo primary supports no Context; MiMo refine supports it.
      primary: { provider: 'mimo', endpoint: null, values: { model: 'mimo-v2.5-asr' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'm' },
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
  expectTruthy(primaryBody.messages.every(m => !JSON.stringify(m).includes('useEffect')))

  const refineBody = transport.requests[1].body
  // The refine request carries the user's free text verbatim, as its own
  // system message.
  const systemMessages = refineBody.messages.filter(m => m.role === 'system')
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
  try { normalizeContext({ text: 42 }) } catch (e) { threw = e }
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

// --- Trace safety ---------------------------------------------------------------

test('trace and warnings never carry credentials or context contents', async () => {
  const transport = new FakeTransport({
    responses: [
      dashscopeResponse('primary text'),
      { status: 500, headers: {}, body: encodeBody({ secret: 'leak' }) }
    ]
  })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen3-asr-flash' } },
      refine: {
        enabled: true,
        execution: 'separate',
        provider: 'mimo',
        endpoint: null,
        values: { model: 'm' },
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

// --- Runtime replacement --------------------------------------------------------

test('provider behavior is identical through an interchangeable transport', async () => {
  // Two different fake transports, same provider config: providers must only
  // depend on the HttpTransport contract, not the Host.
  class OtherTransport {
    constructor () { this.requests = [] }
    async send (request) {
      this.requests.push(request)
      return dashscopeResponse('same text')
    }
  }
  const other = new OtherTransport()
  const result = await runKernel({
    config: baseConfig({ provider: 'qwen' }),
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: { transport: other, clock: { now: () => 0 } },
    signal: null
  })

  expectEqual(result.text, 'same text')
  expectEqual(other.requests.length, 1)
})

// --- Qwen model/protocol routing -------------------------------------------------

test('qwen audio-3.0 and fun-asr route to the asr3 endpoint and context part', async () => {
  for (const model of ['qwen-audio-3.0-asr-flash', 'fun-asr-flash-2026-06-15']) {
    const transport = new FakeTransport({
      responses: [asr3Response('asr3 text')]
    })
    const result = await runKernel({
      config: {
        primary: { provider: 'qwen', endpoint: null, values: { model } },
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
    // Context rides as an input_text part before the audio part.
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
        endpoint: null,
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
  // OpenAI-compatible shape: system context + input_audio, no input wrapper.
  expectEqual(body.messages[0].role, 'system')
  expectEqual(body.messages[0].content, CONTEXT.text)
  expectEqual(body.messages[1].content[0].type, 'input_audio')
  expectEqual(body.asr_options.enable_itn, true)
  expectEqual(result.text, 'compat text')
})

test('unknown qwen models stay conservative and use the native endpoint', async () => {
  const transport = new FakeTransport({ responses: [dashscopeResponse('fallback text')] })
  const result = await runKernel({
    config: {
      primary: { provider: 'qwen', endpoint: null, values: { model: 'qwen-unknown-model' } },
      refine: { enabled: false }
    },
    audio: AUDIO,
    context: CONTEXT,
    secrets: SECRETS,
    runtime: runtimeFor(transport),
    signal: null
  })

  expectEqual(transport.requests[0].url,
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  // No context part: the unknown model declares no Context capability.
  expectEqual(transport.requests[0].body.input.messages.length, 1)
  expectEqual(result.text, 'fallback text')
})

await run()
