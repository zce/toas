// Overlay monitor selection and position math.

import { calculateOverlayPosition, selectMonitor } from '../ui/placement.js'
import { expectEqual, run, test } from './harness.js'

const primary = { x: 0, y: 0, width: 1920, height: 1080 }
const secondary = { x: 1920, y: -120, width: 2560, height: 1440, geometry_scale: 1 }

test('target monitor selection uses the requested secondary monitor', () => {
  expectEqual(selectMonitor([primary, secondary], primary, 1), secondary)
})

test('missing target monitor falls back to primary', () => {
  expectEqual(selectMonitor([primary], primary, 4), primary)
  expectEqual(selectMonitor([primary], primary, null), primary)
})

test('overlay position includes the monitor origin', () => {
  expectEqual(calculateOverlayPosition(secondary, 400, 48, 112), { x: 3000, y: 1160 })

  const leftMonitor = { x: -1600, y: 80, width: 1600, height: 900, geometry_scale: 1 }
  expectEqual(calculateOverlayPosition(leftMonitor, 320, 40, 112), { x: -960, y: 828 })
})

test('fractional scales place the overlay on device pixels', () => {
  const scale = 1.3333333730697632
  const monitor = { x: 2580, y: 0, width: 2580, height: 1080, geometry_scale: scale }
  const { x, y } = calculateOverlayPosition(monitor, 148, 36, 112)
  const device = [(x - monitor.x) * scale, (y - monitor.y) * scale]
  expectEqual(device.map(value => Math.round(value * 1e6) / 1e6), [1621, 1243])
})

await run()
