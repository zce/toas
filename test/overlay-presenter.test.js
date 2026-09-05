import { ToasOverlayPresenter } from '../lib/ui/overlay-presenter.js'
import { test, expectEqual, run } from './harness.js'

class FakeOverlayView {
  constructor ({ hideDelay = 0 } = {}) {
    this.renders = []
    this.visibility = []
    this.spinners = []
    this.privateFlags = []
    this.hidden = false
    this.shown = false
    this.hideCalls = 0
    this.showCalls = 0
    this.resetCalls = 0
    this.destroyed = 0
    this.timerFn = null
  }

  render (state, message) {
    this.renders.push({ state, message })
  }

  setVisible (recording, error, statusVisible) {
    this.visibility.push({ recording, error, statusVisible })
  }

  startSpinner () { this.spinnerStarted = true }
  stopSpinner () { this.spinnerStopped = true }
  show () { this.showCalls++ }
  hide () { this.hideCalls++ }
  setLevel (level) { this.level = level }
  resetLevels () { this.resetCalls++ }
  setPrivate (enabled) { this.privateFlags.push(enabled) }
  destroy () { this.destroyed++ }
}

const flushAsync = ms => new Promise(resolve => setTimeout(resolve, ms))

test('idle hides the overlay and clears timers', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('error', 'boom')
  presenter.render('idle')

  expectEqual(view.hideCalls >= 1, true)
  expectEqual(presenter._timer, null)
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
  presenter.render('processing')
  await flushAsync(80)

  expectEqual(view.hideCalls, 0)
  expectEqual(view.renders[1].state, 'processing')
  presenter.destroy()
})

test('spinner runs only for processing states', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('processing')
  expectEqual(view.spinnerStarted, true)
  expectEqual(view.spinnerStopped ?? false, false)

  presenter.render('recording')
  expectEqual(view.spinnerStopped, true)
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

test('private mode is delegated to the view without a text label', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.render('recording')
  expectEqual(view.renders.at(-1).message, '')

  // The presenter forwards the run snapshot; the view owns the decoration.
  presenter.setPrivate(true)
  expectEqual(view.privateFlags.at(-1), true)
  expectEqual(view.renders.at(-1).message, '')

  presenter.setPrivate(false)
  expectEqual(view.privateFlags.at(-1), false)
  presenter.destroy()
})

test('repeated setPrivate calls delegate only on change', () => {
  const view = new FakeOverlayView()
  const presenter = new ToasOverlayPresenter({ view })

  presenter.setPrivate(true)
  expectEqual(view.privateFlags.length, 1)

  presenter.setPrivate(true)
  expectEqual(view.privateFlags.length, 1)

  presenter.setPrivate(false)
  expectEqual(view.privateFlags.length, 2)
  presenter.destroy()
})

await run()
