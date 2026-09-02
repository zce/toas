import { OnboardingManager } from '../lib/onboarding.js'
import { test, expectEqual, run } from './harness.js'

class FakeSettings {
  constructor () {
    this.values = {}
  }

  get_boolean (key) { return this.values[key] ?? false }
  set_boolean (key, value) { this.values[key] = value }
}

class FakeNotifier {
  constructor () { this.notifications = [] }
  notify (title, body) { this.notifications.push({ title, body }) }
}

function make ({ shown = false, hasHistory = false, notify = true, withPrefsOpener = true } = {}) {
  const settings = new FakeSettings()
  settings.values['onboarding-shown'] = shown
  const notifier = new FakeNotifier()
  let prefsOpened = 0
  const onboarding = new OnboardingManager({
    settings,
    notifier: notify ? notifier : null,
    onOpenPreferences: withPrefsOpener ? () => prefsOpened++ : null,
    hasExistingHistory: () => hasHistory
  })
  return { onboarding, settings, notifier, getPrefsOpened: () => prefsOpened }
}

test('fresh install: onboarding shows exactly once with disclosure', () => {
  const { onboarding, settings, notifier } = make()

  const shown = onboarding.maybeShowOnboarding()
  expectEqual(shown, true)
  expectEqual(notifier.notifications.length, 1)

  const body = notifier.notifications[0].body
  expectEqual(body.includes('transcription service'), true)
  expectEqual(body.includes('kept locally'), true)
  expectEqual(body.includes('clear anytime'), true)

  // Second call is a no-op.
  expectEqual(onboarding.maybeShowOnboarding(), false)
  expectEqual(notifier.notifications.length, 1)
  expectEqual(settings.values['onboarding-shown'], true)
})

test('upgrading user with history: silent migration', () => {
  const { onboarding, settings, notifier } = make({ hasHistory: true })

  expectEqual(onboarding.maybeShowOnboarding(), false)
  expectEqual(notifier.notifications, [])
  expectEqual(settings.values['onboarding-shown'], true)
})

test('unconfigured guard warns once and opens preferences', () => {
  const { onboarding, getPrefsOpened } = make()

  expectEqual(onboarding.guardUnconfigured(false), true)
  expectEqual(getPrefsOpened(), 1)
  expectEqual(onboarding.guardUnconfigured(true), false)
  expectEqual(getPrefsOpened(), 1)
})

await run()