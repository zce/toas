import Gio from 'gi://Gio'

import { EarconPlayer } from '../host/earcons.js'
import { CUE_GUARD_MS, cueDurationMs } from '../host/earcon-synthesis.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

function fakePlayer(styles) {
  const played = []
  const player = Object.create(EarconPlayer.prototype)
  player._settings = { get_string: key => styles[key] }
  player._files = new Map([
    ['start-crystal', { name: 'start-crystal' }],
    ['end-tap', { name: 'end-tap' }]
  ])
  player._playing = null
  player._player = {
    play_from_file: (file, description, cancellable) => {
      played.push({ file, description, cancellable })
    }
  }
  return { player, played }
}

test('None does not play a cue or add a capture delay', () => {
  const { player, played } = fakePlayer({
    'sound-start-style': 'none',
    'sound-end-style': 'none'
  })

  expectEqual(player.play('start'), 0)
  expectEqual(player.play('end'), 0)
  expectEqual(played.length, 0)
})

test('native sound player uses independent styles and cancellable playback', () => {
  const { player, played } = fakePlayer({
    'sound-start-style': 'none',
    'sound-end-style': 'tap'
  })

  expectEqual(player.play('start'), 0)
  expectEqual(player.play('end'), cueDurationMs('end', 'tap') + CUE_GUARD_MS)
  expectEqual(played.length, 1)
  expectEqual(played[0].file.name, 'end-tap')
  expectTruthy(played[0].cancellable instanceof Gio.Cancellable)
  expectEqual(played[0].cancellable.is_cancelled(), false)

  player.cancel()
  expectEqual(played[0].cancellable.is_cancelled(), true)
})

test('playback errors leave recording available without a sound delay', () => {
  const { player } = fakePlayer({ 'sound-start-style': 'crystal' })
  player._player.play_from_file = () => { throw new Error('Audio backend unavailable') }
  const warn = console.warn
  console.warn = () => {}

  try {
    expectEqual(player.play('start'), 0)
    expectEqual(player._playing, null)
  } finally {
    console.warn = warn
  }
})

await run()
