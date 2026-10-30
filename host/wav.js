// 44-byte PCM WAV header: RIFF/fmt/data sizes for mono s16 at sampleRate.
export function wavHeader(pcmBytes, sampleRate) {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) {
      header[offset + i] = value.charCodeAt(i)
    }
  }

  const blockAlign = 2

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcmBytes, true)

  return header
}
