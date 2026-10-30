import { CUE_STYLES, CUE_GUARD_MS, cueDurationMs, synthesizeCue } from '../host/earcon-synthesis.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('four independently selectable start and stop sound styles', () => {
  expectEqual(CUE_STYLES, ['tap', 'crystal', 'pulse', 'halo'])
  expectEqual(CUE_GUARD_MS, 100)

  for (const style of CUE_STYLES) {
    for (const kind of ['start', 'end']) {
      const data = synthesizeCue(kind, style)
      const view = new DataView(data.buffer)

      expectEqual(String.fromCharCode(...data.slice(0, 4)), 'RIFF')
      expectEqual(String.fromCharCode(...data.slice(8, 12)), 'WAVE')
      expectEqual(view.getUint32(24, true), 16000)
      expectEqual(view.getUint16(22, true), 1)
      expectEqual(view.getUint16(34, true), 16)
      expectEqual(view.getUint32(40, true), data.length - 44)
      expectEqual(data.length, 44 + Math.ceil(16 * cueDurationMs(kind, style)) * 2)

      let max = 0
      for (let i = 44; i < data.length; i += 2) {
        max = Math.max(max, Math.abs(view.getInt16(i, true)))
      }
      expectTruthy(max > 150 && max < 32767, kind + ' ' + style)
    }
  }
})

await run()
