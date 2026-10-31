import { wavHeader } from './wav.js'

export const CUE_STYLES = ['tap', 'crystal', 'pulse', 'halo']
export const DEFAULT_START_CUE = 'crystal'
export const DEFAULT_END_CUE = 'tap'

const RATE = 16000

// Each tone: start/end frequency (Hz), duration (s), amplitude,
// waveform, attack (s), release (s), and start delay (s).
const tones = {
  tap: {
    start: [
      [735, 690, .088, .16, 'triangle', .003, .063, 0],
      [1130, 1130, .045, .042, 'sine', .002, .032, 0],
      [870, 870, .135, .055, 'sine', .011, .107, .028]
    ],
    end: [
      [590, 555, .110, .118, 'triangle', .004, .082, 0],
      [790, 790, .058, .030, 'sine', .003, .046, 0],
      [440, 440, .150, .043, 'sine', .012, .117, .020]
    ]
  },
  crystal: {
    start: [
      [740, 740, .200, .092, 'sine', .004, .184, 0],
      [1110, 1110, .210, .072, 'sine', .005, .196, .048],
      [1480, 1480, .095, .016, 'sine', .005, .080, .049]
    ],
    end: [
      [990, 990, .140, .068, 'sine', .003, .123, 0],
      [660, 660, .225, .095, 'sine', .008, .205, .042],
      [1320, 1320, .085, .013, 'sine', .006, .072, .048]
    ]
  },
  pulse: {
    start: [
      [620, 640, .061, .118, 'triangle', .002, .047, 0],
      [1060, 1060, .037, .020, 'sine', .001, .029, 0],
      [780, 810, .085, .144, 'triangle', .003, .069, .079],
      [1400, 1400, .031, .019, 'sine', .002, .023, .080]
    ],
    end: [
      [810, 780, .061, .109, 'triangle', .002, .050, 0],
      [560, 540, .100, .102, 'triangle', .003, .083, .073],
      [1030, 1030, .032, .012, 'sine', .002, .026, .072]
    ]
  },
  halo: {
    start: [
      [520, 535, .230, .069, 'sine', .052, .147, 0],
      [780, 780, .250, .052, 'sine', .066, .151, .020],
      [1040, 1040, .210, .017, 'sine', .075, .123, .031]
    ],
    end: [
      [660, 645, .205, .062, 'sine', .035, .130, 0],
      [440, 440, .238, .078, 'sine', .046, .160, .028],
      [880, 880, .150, .014, 'sine', .035, .092, .025]
    ]
  }
}

const durations = {
  tap: { start: 170, end: 190 },
  crystal: { start: 270, end: 280 },
  pulse: { start: 180, end: 190 },
  halo: { start: 290, end: 280 }
}

export function cueDurationMs(kind, style) {
  return durations[style]?.[kind] ?? 0
}

export function synthesizeCue(kind, style) {
  const parts = tones[style]?.[kind]
  if (!parts) {
    throw new Error('Invalid cue')
  }

  const sampleCount = Math.ceil(RATE * cueDurationMs(kind, style) / 1000)
  const wav = new Uint8Array(44 + sampleCount * 2)
  const view = new DataView(wav.buffer)
  wav.set(wavHeader(sampleCount * 2, RATE))

  for (let i = 0; i < sampleCount; i++) {
    const sampleTime = i / RATE
    let sample = 0

    for (const [startHz, endHz, duration, volume, waveform, attack, release, delay] of parts) {
      const toneTime = sampleTime - delay
      if (toneTime < 0 || toneTime >= duration) {
        continue
      }

      const angle = 2 * Math.PI *
        (startHz * toneTime + (endHz - startHz) * toneTime * toneTime / (2 * duration))
      const sin = Math.sin(angle)
      const wave = waveform === 'triangle' ? 2 / Math.PI * Math.asin(sin) : sin
      const envelope = Math.max(0, Math.min(1, toneTime / attack, (duration - toneTime) / release))
      sample += wave * volume * envelope
    }

    view.setInt16(44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, sample * .86)) * 32767), true)
  }

  return wav
}
