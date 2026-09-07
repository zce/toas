// Kernel stage signals and step ordering.

import { process as kernelProcess } from '../kernel/process.js'
import { expectEqual, run, test } from './harness.js'

function provider({ inputs, instructions, text, events, name }) {
  return {
    manifest: { fields: [] },
    resolve() {
      return {
        config: { model: name },
        capabilities: { inputs, instructions, context: false },
        issues: []
      }
    },
    create() {
      return {
        async process() {
          events.push(name)
          return { text, usage: null, requestId: null, responseId: null }
        }
      }
    }
  }
}

const AUDIO = {
  kind: 'audio',
  base64: 'ZmFrZQ==',
  mimeType: 'audio/wav',
  durationMs: 1000
}

const runtime = {
  transport: null,
  clock: { now: () => 0 }
}

test('refine stage signal occurs after primary and before refine execution', async () => {
  const events = []
  const providers = new Map([
    [
      'primary',
      provider({
        inputs: ['audio'],
        instructions: false,
        text: 'raw transcript',
        events,
        name: 'primary'
      })
    ],
    [
      'refine',
      provider({
        inputs: ['text'],
        instructions: true,
        text: 'refined text',
        events,
        name: 'refine'
      })
    ]
  ])

  const result = await kernelProcess({
    config: {
      primary: { provider: 'primary', values: {} },
      refine: {
        enabled: true,
        provider: 'refine',
        values: {},
        instructions: 'Polish.',
        onError: 'fallback'
      }
    },
    audio: AUDIO,
    context: { text: '' },
    secrets: {},
    runtime,
    signal: null,
    providers,
    onStage: stage => events.push(`stage:${stage}`)
  })

  expectEqual(events, ['primary', 'stage:refine', 'refine'])
  expectEqual(result.text, 'refined text')
})

test('disabled refine emits no refine stage signal', async () => {
  const events = []
  const providers = new Map([
    [
      'primary',
      provider({
        inputs: ['audio'],
        instructions: false,
        text: 'raw transcript',
        events,
        name: 'primary'
      })
    ]
  ])

  await kernelProcess({
    config: {
      primary: { provider: 'primary', values: {} },
      refine: { enabled: false }
    },
    audio: AUDIO,
    context: { text: '' },
    secrets: {},
    runtime,
    signal: null,
    providers,
    onStage: stage => events.push(`stage:${stage}`)
  })

  expectEqual(events, ['primary'])
})

await run()
