import { calculateOverlayPosition, selectMonitor } from '../ui/placement.js'
import { test, expectEqual, run } from './harness.js'

const primary = { x: 0, y: 0, width: 1920, height: 1080 }
const secondary = { x: 1920, y: -120, width: 2560, height: 1440 }

test('target monitor selection uses the requested secondary monitor', () => {
  expectEqual(selectMonitor([primary, secondary], primary, 1), secondary)
})

test('missing target monitor falls back to primary', () => {
  expectEqual(selectMonitor([primary], primary, 4), primary)
  expectEqual(selectMonitor([primary], primary, null), primary)
})

test('overlay position includes the monitor origin', () => {
  expectEqual(
    calculateOverlayPosition(secondary, 400, 48, 112),
    { x: 3000, y: 1160 }
  )

  const leftMonitor = { x: -1600, y: 80, width: 1600, height: 900 }
  expectEqual(
    calculateOverlayPosition(leftMonitor, 320, 40, 112),
    { x: -960, y: 828 }
  )
})

test('monitor-bottom placement stays centered on the selected monitor', () => {
  const monitor = selectMonitor([primary, secondary], primary, 1)
  const width = 240
  const height = 8
  const position = calculateOverlayPosition(monitor, width, height, 0)

  expectEqual(position, { x: 3080, y: 1312 })
  expectEqual(position.x + width / 2, monitor.x + monitor.width / 2)
  expectEqual(position.y + height, monitor.y + monitor.height)
})

await run()
