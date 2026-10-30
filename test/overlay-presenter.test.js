// Overlay presenter state machine against a fake view.

import { ToasOverlayPresenter } from '../ui/overlay.js'
import { expectEqual, expectTruthy, run, test } from './harness.js'

class FakeOverlayView {
  constructor() {
    this.renders = []
    this.modes = []
    this.privateFlags = []
    this.hideCalls = 0
    this.showCalls = 0
    this.resetCalls = 0
    this.destroyed = 0
  }

  render(state, message) {
    this.renders.push({ state, message })
  }

  setMode(mode) {
    this.modes.push(mode)
  }

  show() {
    this.showCalls++
  }
  hide() {
    this.hideCalls++
  }
  setLevel(level) {
    this.level = level
  }
  resetLevels() {
    this.resetCalls++
  }
  setPrivate(enabled) {
    this.privateFlags.push(enabled)
  }
  setOnCancelRequested(handler) {
    this.onCancelRequested = handler
  }
  destroy() {
    this.destroyed++
  }
}

const flushAsync = ms => new Promise(resolve => setTimeout(resolve, ms))

test('idle hides the overlay and clears timers', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('error', 'boom')
  presenter.render('idle')

  expectEqual(view.hideCalls, 1)
  expectEqual(presenter._timer, null)
  presenter.destroy()
})

test('idle preserves the current visual mode until the view hides', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('transcribing')
  presenter.render('idle')

  expectEqual(view.modes, ['busy'])
  expectEqual(view.hideCalls, 1)
  presenter.destroy()
})

test('error schedules exactly one hide after the delay', async () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view, hideDelay: 30 })

  presenter.render('error', 'broken')

  expectEqual(view.hideCalls, 0)
  await flushAsync(60)
  expectEqual(view.hideCalls, 1)
  presenter.destroy()
})

test('a newer render supersedes the pending error hide', async () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view, hideDelay: 40 })

  presenter.render('error', 'broken')
  presenter.render('transcribing')
  await flushAsync(80)

  expectEqual(view.hideCalls, 0)
  expectEqual(view.renders[1].state, 'transcribing')
  presenter.destroy()
})

test('busy states render truthful stage labels', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('transcribing')
  presenter.render('refining')
  presenter.render('outputting')
  presenter.render('copying')

  expectEqual(view.renders, [
    { state: 'transcribing', message: 'Transcribing…' },
    { state: 'refining', message: 'Refining…' },
    { state: 'outputting', message: 'Inserting…' },
    { state: 'copying', message: 'Copying…' }
  ])
  expectEqual(view.modes, ['busy', 'busy', 'busy', 'busy'])
  presenter.destroy()
})

test('error uses the terminal visual mode', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('transcribing')
  presenter.render('error', 'broken')

  expectEqual(view.modes, ['busy', 'error'])
  presenter.destroy()
})

test('resetLevels clears the view through the presenter', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.resetLevels()

  expectEqual(view.resetCalls, 1)
  presenter.destroy()
})

test('destroy clears pending timers and tears down the view', async () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view, hideDelay: 40 })

  presenter.render('error', 'broken')
  presenter.destroy()

  expectEqual(presenter._timer, null)
  expectEqual(view.destroyed, 1)
  await flushAsync(60)
  expectEqual(view.hideCalls, 0)
})

test('switching HUD views preserves cancellation without running both', () => {
  const oldView = new FakeOverlayView()
  const nextView = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view: oldView })
  const cancel = () => {}
  presenter.setOnCancelRequested(cancel)
  presenter.replaceView(() => nextView)

  expectTruthy(nextView.onCancelRequested === cancel)
  expectEqual(oldView.destroyed, 1)
  expectEqual(nextView.destroyed, 0)
  presenter.render('recording')
  expectEqual(oldView.renders.length, 0)
  expectEqual(nextView.renders.length, 1)
  presenter.destroy()
  expectEqual(nextView.destroyed, 1)
})

test('switching views cancels the pending error-hide timer', async () => {
  const oldView = new FakeOverlayView()
  const nextView = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view: oldView, hideDelay: 20 })

  presenter.render('error', 'broken')
  presenter.replaceView(() => nextView)
  await flushAsync(40)

  expectEqual(oldView.destroyed, 1)
  expectEqual(nextView.hideCalls, 0)
  presenter.destroy()
})

test('private mode is delegated to the view without a text label', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('recording')
  expectEqual(view.renders.at(-1).message, '')

  presenter.setPrivate(true)
  expectEqual(view.privateFlags.at(-1), true)
  expectEqual(view.renders.at(-1).message, '')

  presenter.setPrivate(false)
  expectEqual(view.privateFlags.at(-1), false)
  presenter.destroy()
})

await run()
