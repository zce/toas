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
export function calculateOverlayPosition(monitor, width, height, bottomMargin) {
  return {
    x: Math.round(monitor.x + (monitor.width - width) / 2),
    y: Math.round(monitor.y + monitor.height - bottomMargin - height)
  }
}
