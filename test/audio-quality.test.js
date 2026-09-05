import { resolveSampleRate, AUDIO_QUALITY_PRESETS } from '../host/audio.js'
import { test, expectEqual, run } from './harness.js'

class FakeSettings {
  constructor (values = {}) {
    this.values = values
  }

  get_string (key) {
    return this.values[key] ?? 'standard'
  }
}

test('sample rate follows the audio quality setting', () => {
  expectEqual(resolveSampleRate(new FakeSettings()), AUDIO_QUALITY_PRESETS.standard.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 'minimum' })), AUDIO_QUALITY_PRESETS.minimum.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 'low' })), AUDIO_QUALITY_PRESETS.low.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 'high' })), AUDIO_QUALITY_PRESETS.high.sampleRate)
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 'maximum' })), AUDIO_QUALITY_PRESETS.maximum.sampleRate)
})

test('unknown quality values degrade to the standard rate', () => {
  expectEqual(resolveSampleRate(new FakeSettings({ 'audio-quality': 'unknown' })), AUDIO_QUALITY_PRESETS.standard.sampleRate)
})

await run()
