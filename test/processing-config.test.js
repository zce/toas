// Processing configuration persistence: defaults, normalization,
// provider switching, and malformed input handling.

import {
  DEFAULT_REFINE_INSTRUCTIONS,
  normalizeProcessingConfig,
  readProcessingConfig,
  snapshotProcessingConfig,
  switchProcessingProvider,
  writeProcessingConfig
} from '../host/config.js'
import { providers } from '../kernel/providers/registry.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

class FakeSettings {
  constructor(text = '{}') {
    this.text = text
  }
  get_string(key) {
    if (key !== 'processing-config') {
      throw new Error(`unexpected key ${key}`)
    }
    return this.text
  }
  set_string(key, value) {
    if (key !== 'processing-config') {
      throw new Error(`unexpected key ${key}`)
    }
    this.text = value
  }
}

test('empty persistence gets product defaults from Provider selection defaults', () => {
  const config = normalizeProcessingConfig({}, providers)
  expectEqual(config.primary.provider, 'qwen')
  expectEqual(config.primary.values.model, 'qwen-audio-3.1-asr-flash')
  expectEqual(config.refine.provider, 'mimo')
  expectEqual(config.refine.values.model, 'mimo-v2.6-flash')
  expectEqual(config.refine.values.thinking, 'off')
  expectEqual(config.refine.instructions, DEFAULT_REFINE_INSTRUCTIONS)
  expectTruthy(DEFAULT_REFINE_INSTRUCTIONS.includes('within otherwise meaningful speech'))
  expectTruthy(DEFAULT_REFINE_INSTRUCTIONS.includes('Preserve standalone interjections or acknowledgements'))
  expectTruthy(DEFAULT_REFINE_INSTRUCTIONS.includes('Use paragraph breaks when the speaker clearly moves to a new thought or topic'))
  expectTruthy(DEFAULT_REFINE_INSTRUCTIONS.includes('keep short, continuous speech in a single paragraph'))
})

test('empty saved endpoints resolve through manifest defaults instead of hiding them', () => {
  const fake = {
    manifest: {
      fields: [{ key: 'endpoint', type: 'url', default: 'https://default.example/v1', env: [] }],
      defaults: { audio: { model: 'audio-model' }, text: { model: 'text-model' } }
    },
    supports: () => true
  }
  const registry = new Map([['fake', fake]])
  const configFor = endpoint => new FakeSettings(JSON.stringify({
    providers: { fake: { endpoint } },
    primary: { provider: 'fake', values: { model: 'audio-model' } },
    refine: { provider: 'fake', values: { model: 'text-model' } }
  }))
  const blank = snapshotProcessingConfig(configFor(''), registry)
  expectEqual(blank.providers.fake.endpoint, undefined)
  expectEqual(fake.manifest.fields[0].default, 'https://default.example/v1')
  const custom = snapshotProcessingConfig(configFor('https://custom.example/v1'), registry)
  expectEqual(custom.providers.fake.endpoint, 'https://custom.example/v1')
})

test('stored Refine instructions remain verbatim user-owned data', () => {
  const instructions = '  Keep this terse.\nPreserve my formatting.  '
  const config = normalizeProcessingConfig({ refine: { instructions } }, providers)
  expectEqual(config.refine.instructions, instructions)
})

test('Provider values and arbitrary selection values round trip generically', () => {
  const settings = new FakeSettings()
  const expected = normalizeProcessingConfig(
    {
      providers: { custom: { region: 'cn', deployment: 'voice' } },
      primary: { provider: 'mimo', values: { model: 'mimo-v2.5-asr', language: 'zh' } },
      refine: { enabled: true, provider: 'openai-compatible', values: { model: 'private-model', thinking: 'default' } }
    },
    providers
  )
  writeProcessingConfig(settings, expected)
  expectEqual(readProcessingConfig(settings, providers), expected)
})

test('Refine selection values survive Provider switches and reload', () => {
  const settings = new FakeSettings()
  const config = normalizeProcessingConfig(
    {
      refine: { enabled: true, provider: 'mimo', values: { model: 'mimo-v2.6-pro', thinking: 'default' } }
    },
    providers
  )

  switchProcessingProvider(config, 'refine', 'openai-compatible', providers)
  config.refine.values.model = 'private-refine-model'
  switchProcessingProvider(config, 'refine', 'mimo', providers)
  expectEqual(config.refine.values.model, 'mimo-v2.6-pro')
  expectEqual(config.refine.values.thinking, 'default')

  writeProcessingConfig(settings, config)
  const restored = readProcessingConfig(settings, providers)
  switchProcessingProvider(restored, 'refine', 'openai-compatible', providers)
  expectEqual(restored.refine.values.model, 'private-refine-model')
})

test('malformed JSON falls back without leaking persistence concerns to Providers', () => {
  const config = readProcessingConfig(new FakeSettings('{broken'), providers)
  expectEqual(config.primary.provider, 'qwen')
  expectTruthy(config.refine.instructions.length > 0)
})

await run()