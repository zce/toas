import GLib from 'gi://GLib'
import { resolveTranscriptionConfig, resolveRefineConfig, ConfigSource, resolveSampleRate, AUDIO_QUALITY_PRESETS } from '../lib/effective-config.js'
import { test, expectEqual, run } from './harness.js'

class FakeSettings {
  constructor (values = {}, env = {}) {
    this.values = values
    this.env = env
  }

  get_user_value (key) {
    return Object.prototype.hasOwnProperty.call(this.values, key)
      ? this.values[key]
      : null
  }

  get_string (key) {
    return this.get_user_value(key) ?? ''
  }

  get_boolean (key) {
    return this.get_user_value(key) ?? false
  }

  get_enum (key) {
    return this.get_user_value(key) ?? 0
  }

  getenv (name) {
    return this.env[name] ?? null
  }
}

// effective-config uses GLib.getenv; route env through an injectable shim by
// stubbing GLib for the test process.
const realGetenv = GLib.getenv

function withEnv (env, fn) {
  GLib.getenv = name => env[name] ?? null
  try {
    return fn()
  } finally {
    GLib.getenv = realGetenv
  }
}

test('defaults: empty settings yield ready=false with default sources', () => {
  withEnv({}, () => {
    const t = resolveTranscriptionConfig(new FakeSettings())
    expectEqual(t.endpoint.source, ConfigSource.DEFAULT)
    expectEqual(t.model.source, ConfigSource.DEFAULT)
    expectEqual(t.apiKey.present, false)
    expectEqual(t.ready, false)
  })
})

test('user override beats environment for endpoint', () => {
  withEnv({ TOAS_TRANSCRIPTION_ENDPOINT: 'https://env.example' }, () => {
    const t = resolveTranscriptionConfig(new FakeSettings({
      'transcription-endpoint': 'https://user.example'
    }))
    expectEqual(t.endpoint.value, 'https://user.example')
    expectEqual(t.endpoint.source, ConfigSource.USER)
  })
})

test('environment-only key counts as configured and ready', () => {
  withEnv({ TOAS_TRANSCRIPTION_API_KEY: '  sk-env  ' }, () => {
    const t = resolveTranscriptionConfig(new FakeSettings())
    expectEqual(t.apiKey.present, true)
    expectEqual(t.apiKey.source, ConfigSource.ENVIRONMENT)
    expectEqual(t.ready, true)
  })
})

test('key value never leaks into the resolved config', () => {
  withEnv({ TOAS_TRANSCRIPTION_API_KEY: 'sk-super-secret' }, () => {
    const t = resolveTranscriptionConfig(new FakeSettings())
    expectEqual(JSON.stringify(t).includes('sk-super-secret'), false)
  })
})

test('refine readiness requires enabled + model + key', () => {
  withEnv({}, () => {
    const disabled = resolveRefineConfig(new FakeSettings({ 'refine-enabled': false, 'refine-model': 'm' }))
    expectEqual(disabled.ready, false)

    const noModel = resolveRefineConfig(new FakeSettings({ 'refine-enabled': true }))
    expectEqual(noModel.ready, false)

    const noKey = resolveRefineConfig(new FakeSettings({ 'refine-enabled': true, 'refine-model': 'm' }))
    expectEqual(noKey.ready, false)
    expectEqual(noKey.endpoint.source, ConfigSource.DEFAULT)

    const full = resolveRefineConfig(new FakeSettings({
      'refine-enabled': true,
      'refine-model': 'm',
      'refine-api-key': 'sk'
    }))
    expectEqual(full.ready, true)
  })
})

test('refine key falls back to OPENAI_API_KEY', () => {
  withEnv({ OPENAI_API_KEY: 'sk-openai' }, () => {
    const r = resolveRefineConfig(new FakeSettings({
      'refine-enabled': true,
      'refine-model': 'm'
    }))
    expectEqual(r.apiKey.present, true)
    expectEqual(r.ready, true)
  })
})

test('environment-provided refine model satisfies readiness', () => {
  withEnv({ TOAS_REFINE_MODEL: 'env-model', TOAS_REFINE_API_KEY: 'sk' }, () => {
    const r = resolveRefineConfig(new FakeSettings({ 'refine-enabled': true }))
    expectEqual(r.model.value, 'env-model')
    expectEqual(r.ready, true)
  })
})

test('sample rate follows the audio quality setting', () => {
  expectEqual(resolveSampleRate(new FakeSettings()), AUDIO_QUALITY_PRESETS.standard.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 1 })), AUDIO_QUALITY_PRESETS.high.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 2 })), AUDIO_QUALITY_PRESETS.balanced.sampleRate)
})

test('unknown quality values degrade to the standard rate', () => {
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 99 })), AUDIO_QUALITY_PRESETS.standard.sampleRate)
})

await run()
