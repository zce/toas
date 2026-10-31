// Picks the requested monitor when it exists; otherwise falls back to the
// primary monitor.
export function selectMonitor(monitors, primaryMonitor, targetMonitorIndex) {
  if (Number.isInteger(targetMonitorIndex) && targetMonitorIndex >= 0) {
    const target = monitors?.[targetMonitorIndex]
    if (target) {
      return target
    }
  }

  return primaryMonitor ?? null
}

// Centers horizontally and sits bottomMargin above the monitor's bottom edge.
// The offset is rounded to the monitor's device pixels: St paints straight
// background edges without antialiasing, so between device pixels they no
// longer meet the rounded corners. Only Mutter's logical layout allows
// fractional scales; at integer scales whole logical pixels are device pixels.
export function calculateOverlayPosition(monitor, width, height, bottomMargin) {
  const scale = Number.isInteger(monitor.geometry_scale) ? 1 : monitor.geometry_scale
  const snap = value => Math.round(value * scale) / scale
  return {
    x: monitor.x + snap((monitor.width - width) / 2),
    y: monitor.y + snap(monitor.height - bottomMargin - height)
  }
}
