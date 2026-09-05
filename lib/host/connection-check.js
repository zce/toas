// Connection check for the Preferences UI. Runs the real registered Provider
// through the same resolution pipeline the Kernel uses (resolveStep), then
// one Processor.process call with a harmless input. No probe endpoint, no
// duplicated payload code, no history or output side effects.
//
// Both roles call their own Processor directly — the test is Provider-level
// diagnostics, not a pipeline test. The Kernel seam stays primary-first; a
// text-only refine probe must never route through it.
//
// Inputs are verified live:
// - primary: 0.25 s of silence. The ASR services answer silent audio with
//   no-text (a 200 with empty text, or 400 ASR_RESPONSE_HAVE_NO_WORDS which
//   the Qwen Provider normalizes); either way the round trip, the key, the
//   model, and the response shape all proved themselves.
// - refine: the fixed text 'Reply with OK.' with the configured instructions
//   exercised verbatim, exactly as a real refine step would receive them.

import GLib from 'gi://GLib'

import { resolveStep, processingError } from '../kernel/process.js'
import { SoupHttpTransport } from './soup-http-transport.js'

export async function runConnectionTest ({ configService, providers, role }) {
  if (role !== 'primary' && role !== 'refine') {
    throw processingError('configuration', `Unknown connection test role: ${String(role)}`)
  }

  const config = configService.snapshotConfig()
  const secrets = configService.snapshotSecrets()

  if (role === 'refine' && !config.refine.enabled) {
    throw processingError('configuration', 'Enable Refine first.')
  }

  const selection = role === 'primary' ? config.primary : {
    provider: config.refine.provider,
    values: config.refine.values
  }
  const providerValues = config.providers?.[selection.provider] || {}

  const transport = new SoupHttpTransport({ timeoutMs: 20000 })
  try {
    const resolved = resolveStep({
      providers,
      selection,
      providerValues,
      role,
      secrets,
      runtime: { transport, clock: { now: () => 0 } }
    })

    const input = role === 'primary'
      ? { kind: 'audio', base64: silenceWavBase64(16000), mimeType: 'audio/wav', durationMs: 250 }
      : { kind: 'text', text: 'Reply with OK.' }

    try {
      await resolved.processor.process({
        input,
        context: { text: '' },
        instructions: role === 'refine' ? config.refine.instructions || '' : null,
        signal: null
      })
    } catch (error) {
      // Silent audio legitimately produces no text; the round trip itself
      // is what the test proves.
      if (error.category === 'no-text') { return }
      throw error
    }
  } finally {
    transport.destroy()
  }
}

// 0.25 s of silence, 16 kHz mono 16-bit, wrapped in a minimal WAV header.
function silenceWavBase64 (sampleRate) {
  const durationSeconds = 0.25
  const sampleCount = Math.floor(sampleRate * durationSeconds)
  const dataBytes = sampleCount * 2

  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) { view.setUint8(offset + i, text.charCodeAt(i)) }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  const wav = new Uint8Array(44 + dataBytes)
  wav.set(new Uint8Array(header), 0)
  return GLib.base64_encode(wav)
}
