import Gio from 'gi://Gio'

import { EarconPlayer } from '../host/earcons.js'
import { CUE_STYLES, cueDurationMs } from '../host/earcon-synthesis.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

function fakePlayer(styles, eventSounds = true) {
  const played = []
  const player = Object.create(EarconPlayer.prototype)
  player._settings = { get_string: key => styles[key] }
  player._soundSettings = { get_boolean: () => eventSounds }
  player._files = new Map(CUE_STYLES.flatMap(style => ['start', 'end'].map(kind => {
    const name = `${kind}-${style}`
    return [name, { name }]
  })))
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

test('starting with None cancels a still-playing stop cue', () => {
  const styles = {
    'sound-start-style': 'none',
    'sound-end-style': 'tap'
  }
  const { player, played } = fakePlayer(styles)

  player.play('end')
  expectEqual(played.length, 1)
  expectEqual(played[0].cancellable.is_cancelled(), false)

  expectEqual(player.play('start'), 0)
  expectEqual(played[0].cancellable.is_cancelled(), true)
  expectEqual(played.length, 1)
})

test('disabled GNOME event sounds do not block microphone capture', () => {
  const { player, played } = fakePlayer({ 'sound-start-style': 'crystal' }, false)

  expectEqual(player.play('start'), 0)
  expectEqual(played.length, 0)
})

test('native sound player uses independent styles and cancellable playback', () => {
  for (const [index, start] of CUE_STYLES.entries()) {
    const end = CUE_STYLES[(index + 1) % CUE_STYLES.length]
    const { player, played } = fakePlayer({
      'sound-start-style': start,
      'sound-end-style': end
    })

    expectEqual(player.play('start'), cueDurationMs('start', start) + 100)
    expectEqual(player.play('end'), cueDurationMs('end', end) + 100)
    expectEqual(played.map(cue => cue.file.name), [`start-${start}`, `end-${end}`])
    expectTruthy(played[0].cancellable instanceof Gio.Cancellable)
    expectEqual(played[0].cancellable.is_cancelled(), true)
    expectTruthy(played[1].cancellable instanceof Gio.Cancellable)
    expectEqual(played[1].cancellable.is_cancelled(), false)

    player.cancel()
    expectEqual(played[1].cancellable.is_cancelled(), true)
  }
})

test('playback errors leave recording available without a sound delay', () => {
  const { player } = fakePlayer({ 'sound-start-style': 'crystal' })
  player._player.play_from_file = () => { throw new Error('Audio backend unavailable') }
  expectEqual(player.play('start'), 0)
  expectEqual(player._playing, null)
})

await run()
