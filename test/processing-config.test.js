import {
  DEFAULT_REFINE_INSTRUCTIONS,
  normalizeProcessingConfig,
  readProcessingConfig,
  writeProcessingConfig
} from '../host/config.js'
import { providers } from '../kernel/providers/registry.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

class FakeSettings {
  constructor (text = '{}') { this.text = text }
  get_string (key) {
    if (key !== 'processing-config') { throw new Error(`unexpected key ${key}`) }
    return this.text
  }
  set_string (key, value) {
    if (key !== 'processing-config') { throw new Error(`unexpected key ${key}`) }
    this.text = value
  }
}

test('empty persistence gets product defaults from Provider selection defaults', () => {
  const config = normalizeProcessingConfig({}, providers)
  expectEqual(config.primary.provider, 'qwen')
  expectEqual(config.primary.values.model, 'fun-asr-flash-2026-06-15')
  expectEqual(config.refine.provider, 'mimo')
  expectEqual(config.refine.values.model, 'mimo-v2.5')
  expectEqual(config.refine.instructions, DEFAULT_REFINE_INSTRUCTIONS)
})

test('Provider values and arbitrary selection values round trip generically', () => {
  const settings = new FakeSettings()
  const expected = normalizeProcessingConfig({
    providers: { custom: { region: 'cn', deployment: 'voice' } },
    primary: { provider: 'mimo', values: { model: 'mimo-v2.5-asr', language: 'zh' } },
    refine: { enabled: true, provider: 'openai-compatible', values: { model: 'private-model' } }
  }, providers)
  writeProcessingConfig(settings, expected)
  expectEqual(readProcessingConfig(settings, providers), expected)
})

test('malformed JSON falls back without leaking persistence concerns to Providers', () => {
  const config = readProcessingConfig(new FakeSettings('{broken'), providers)
  expectEqual(config.primary.provider, 'qwen')
  expectTruthy(config.refine.instructions.length > 0)
})

await run()
