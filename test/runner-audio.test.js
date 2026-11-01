// Audio loading uses the existing attempt signal for cancellation.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { KernelRunner } from '../host/runner.js'
import { AttemptSignal } from '../host/transport.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

test('audio loading succeeds and refuses a cancelled attempt', async () => {
  const directory = GLib.dir_make_tmp('toas-runner-test-XXXXXX')
  const path = GLib.build_filenamev([directory, 'clip.wav'])
  GLib.file_set_contents(path, new Uint8Array([1, 2, 3]))
  const runner = new KernelRunner({ settings: {} })
  const recording = { path, mimeType: 'audio/wav', durationMs: 100 }

  try {
    const audio = await runner._loadAudio(recording, null)
    expectEqual(audio.base64, 'AQID')

    const signal = new AttemptSignal()
    signal.abort()
    let error = null
    try {
      await runner._loadAudio(recording, signal)
    } catch (caught) {
      error = caught
    }
    expectTruthy(error, 'a cancelled attempt must not load audio')
  } finally {
    runner.destroy()
    Gio.File.new_for_path(path).delete(null)
    GLib.rmdir(directory)
  }
})

await run()
