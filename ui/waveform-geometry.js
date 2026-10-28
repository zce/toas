// Pixel-aligned geometry: every stroke uses the same integer width and pitch.
export const WAVEFORM_WIDTH = 50
export const WAVEFORM_HEIGHT = 20

export function waveformBars(width, height, levels) {
  if (width <= 0 || height <= 0 || !levels?.length) return []

  const count = levels.length
  const stroke = Math.max(1, Math.round(2 * width / WAVEFORM_WIDTH))
  const pitch = count > 1 ? Math.max(stroke + 1, Math.floor((width - stroke) / (count - 1))) : 0
  const total = stroke + (count - 1) * pitch
  const left = Math.floor((width - total) / 2)
  const centerY = height / 2

  return Array.from(levels, (level, index) => {
    const value = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
    const barHeight = Math.min(height, Math.max(stroke, Math.round((5 + 15 * value) * height / WAVEFORM_HEIGHT)))
    return {
      x: left + index * pitch + stroke / 2,
      top: centerY - (barHeight - stroke) / 2,
      bottom: centerY + (barHeight - stroke) / 2,
      stroke,
      opacity: 0.94 // Keep optical thickness equal, including the edge bars.
    }
  })
}

/**
 * Paint all waveform bars with GJS Cairo's camelCase API.
 * Kept separate from the Shell actor so the real render path can be unit tested.
 */
export function drawWaveform(cr, width, height, levels, lineCap) {
  const bars = waveformBars(width, height, levels)
  if (bars.length === 0) return

  cr.setLineCap(lineCap)
  for (const bar of bars) {
    cr.setLineWidth(bar.stroke)
    cr.setSourceRGBA(1, 1, 1, bar.opacity)
    cr.moveTo(bar.x, bar.top)
    cr.lineTo(bar.x, bar.bottom)
    cr.stroke()
  }
}
