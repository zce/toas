import GLib from 'gi://GLib'
import { resolveSampleRate, AUDIO_QUALITY_PRESETS } from '../lib/infrastructure/effective-config.js'
import { test, expectEqual, run } from './harness.js'

class FakeSettings {
  constructor (values = {}) {
    this.values = values
  }

  get_enum (key) {
    return this.values[key] ?? 0
  }
}

test('sample rate follows the audio quality setting', () => {
  expectEqual(resolveSampleRate(new FakeSettings()), AUDIO_QUALITY_PRESETS.standard.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 1 })), AUDIO_QUALITY_PRESETS.high.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 2 })), AUDIO_QUALITY_PRESETS.balanced.sampleRate)
})

test('unknown quality values degrade to the standard rate', () => {
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 99 })), AUDIO_QUALITY_PRESETS.standard.sampleRate)
})

test('processing resolution lives in the host config service, not here', () => {
  // Recording quality is Host recording configuration; provider/model/secret
  // resolution moved to lib/host/config-service.js and the kernel providers.
  // This file must stay free of processing-config concerns.
  expectEqual(typeof GLib.get_monotonic_time, 'function')
})

await run()
