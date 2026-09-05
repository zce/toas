// Effective configuration resolution for audio quality. Pure data: no GI
// imports at all, Shell or otherwise.

// Recording quality presets. The preset chooses the capture sample rate;
// mono s16 stays fixed. Higher rates produce larger uploads and hit the
// recording size cap sooner (see audio.js MAX_PCM_BYTES).
export const AUDIO_QUALITY_PRESETS = {
  standard: { sampleRate: 16000 },
  high: { sampleRate: 48000 },
  balanced: { sampleRate: 24000 }
}

// Sample rate used when the stored quality value predates the setting or is
// otherwise unknown; matches the format every existing recording uses.
export const DEFAULT_SAMPLE_RATE = AUDIO_QUALITY_PRESETS.standard.sampleRate

// Numeric values of the org.gnome.shell.extensions.toas.AudioQuality enum
// in declaration order; get_enum returns these numbers, not nicks.
const QUALITY_BY_ENUM_VALUE = [
  AUDIO_QUALITY_PRESETS.standard,
  AUDIO_QUALITY_PRESETS.high,
  AUDIO_QUALITY_PRESETS.balanced
]

export function resolveSampleRate (settings) {
  const quality = settings.get_enum?.('audio-quality') ?? 0
  const preset = QUALITY_BY_ENUM_VALUE[quality] ?? AUDIO_QUALITY_PRESETS.standard
  return preset.sampleRate
}
