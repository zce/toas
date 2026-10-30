// Sound cues are cosmetic. The recorder, state machine, and cancellation
// must remain correct when they are enabled, disabled, or interrupted.
import { recordingOutcomeOk } from '../host/audio.js'
import { ToasOrchestrator } from '../host/orchestrator.js'
import {
  FakeHistory,
  FakeKernel,
  FakeNotifier,
  FakeOverlay,
  FakePaster,
  FakeRecorder
} from './fakes.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

const recording = {
  id: 'cue-rec',
  path: '/tmp/cue-rec.wav',
  durationMs: 1500,
  mimeType: 'audio/wav'
}

class CueRecorder extends FakeRecorder {
  constructor() {
    super({ recording: recordingOutcomeOk(recording) })
    this.mutes = []
    this.unmutes = 0
    this.stopDeferred = null
  }

  unmute() {
    this.unmutes++
  }

  stop() {
    this.stops++
    return this.stopDeferred ?? Promise.resolve(this.recording)
  }
}

function create({ startEnabled = true, endEnabled = true, duration = 12 } = {}) {
  const recorder = new CueRecorder()
  const events = []

  const cues = {
    play: kind => {
      if ((kind === 'start' && !startEnabled) || (kind === 'end' && !endEnabled)) {
        return 0
      }

      events.push(kind)
      return kind === 'start' ? duration : 0
    },
    cancel: () => {
      events.push('cancel')
    }
  }

  const settings = {
    get_boolean: key => key === 'auto-paste',
    get_uint: () => 600,
    get_string: key => key === 'sound-start-style' ? (startEnabled ? 'crystal' : 'none') :
      key === 'sound-end-style' ? (endEnabled ? 'tap' : 'none') : 'standard'
  }

  const overlay = new FakeOverlay()
  const orchestrator = new ToasOrchestrator({
    settings,
    cues,
    overlay,
    history: new FakeHistory(),
    kernel: new FakeKernel(),
    output: new FakePaster(),
    notifier: new FakeNotifier(),
    recorderFactory: options => {
      recorder.mutes.push(options.captureInitiallyMuted)
      return recorder
    }
  })

  return { orchestrator, recorder, events, overlay }
}

test('on: cues gate capture and stop cue accompanies immediate Processing visual', async () => {
  const { orchestrator, recorder, events, overlay } = create()
  let release
  recorder.stopDeferred = new Promise(resolve => { release = resolve })

  orchestrator.begin()
  expectEqual(recorder.mutes, [true])
  expectEqual(recorder.unmutes, 0)

  await new Promise(resolve => setTimeout(resolve, 25))
  expectEqual(recorder.unmutes, 1)

  const pending = orchestrator.end()

  // UI moves immediately; end cue must wait until buffered PCM is drained.
  expectEqual(events, ['start'])
  expectTruthy(overlay.states.some(event => event.state === 'transcribing'))

  release(recorder.recording)
  await pending
  expectEqual(events, ['start', 'end'])

  orchestrator.destroy()
})

test('off: no sound, no capture delay, and recorder starts unmuted', async () => {
  const { orchestrator, recorder, events } = create({ startEnabled: false, endEnabled: false })

  orchestrator.begin()
  expectEqual(recorder.mutes, [false])

  await orchestrator.end()
  expectEqual(events, [])
  expectEqual(recorder.unmutes, 0)

  orchestrator.destroy()
})

test('failed native playback opens the capture gate without a timer', async () => {
  const { orchestrator, recorder, events } = create({ duration: 0 })

  orchestrator.begin()
  expectEqual(recorder.mutes, [true])
  expectEqual(recorder.unmutes, 1)
  await orchestrator.end()
  expectEqual(events, ['start', 'end'])

  orchestrator.destroy()
})

test('cancel before the start sound finishes drops the gate and never un-mutes', async () => {
  const { orchestrator, recorder, events } = create({ duration: 55 })

  orchestrator.begin()
  orchestrator.cancel()

  await new Promise(resolve => setTimeout(resolve, 75))
  expectEqual(recorder.unmutes, 0)
  expectEqual(events, ['start', 'cancel'])

  orchestrator.destroy()
})

test('cancel while recorder is draining cannot emit a late stop cue', async () => {
  const { orchestrator, recorder, events } = create()
  let release
  recorder.stopDeferred = new Promise(resolve => { release = resolve })

  orchestrator.begin()
  await new Promise(resolve => setTimeout(resolve, 25))

  const pending = orchestrator.end()
  orchestrator.cancel()

  release(recorder.recording)
  await pending
  expectEqual(events, ['start', 'cancel'])

  orchestrator.destroy()
})

test('quick release before the start cue ends does not falsely confirm', async () => {
  const { orchestrator, recorder, events, overlay } = create({ duration: 65 })
  recorder.recording = { kind: 'short-tap', durationMs: 0 }

  orchestrator.begin()
  await orchestrator.end()

  expectEqual(events, ['start', 'cancel'])
  expectTruthy(overlay.states.some(e => e.state === 'idle'))

  orchestrator.destroy()
})

test('microphone launch failure interrupts the start sound', async () => {
  const { orchestrator, recorder, events } = create({ duration: 80 })
  recorder.start = async () => {
    throw new Error('Microphone is unavailable')
  }

  orchestrator.begin()
  await Promise.resolve()
  await Promise.resolve()

  expectTruthy(events.includes('cancel'))
  expectEqual(events.includes('end'), false)

  orchestrator.destroy()
})

test('start can be None while stop still plays', async () => {
  const { orchestrator, recorder, events } = create({ startEnabled: false })

  orchestrator.begin()
  expectEqual(recorder.mutes, [false])
  await orchestrator.end()

  expectEqual(events, ['end'])
  expectEqual(recorder.unmutes, 0)
  orchestrator.destroy()
})

test('stop can be None while start still gates capture', async () => {
  const { orchestrator, recorder, events } = create({ endEnabled: false })

  orchestrator.begin()
  expectEqual(recorder.mutes, [true])
  await new Promise(resolve => setTimeout(resolve, 25))
  expectEqual(recorder.unmutes, 1)
  await orchestrator.end()

  expectEqual(events, ['start'])
  orchestrator.destroy()
})

await run()
