// First-run onboarding and readiness guard. Shell-side concerns (dialogs,
// opening preferences) are injected; the decision logic is pure.

export class OnboardingManager {
  constructor ({ settings, notifier, onOpenPreferences, hasExistingHistory }) {
    this._settings = settings
    this._notifier = notifier
    this._onOpenPreferences = onOpenPreferences
    this._hasExistingHistory = hasExistingHistory
  }

  // Called on extension enable. Shows the orientation notice exactly once per
  // installation: persistent flag first, then history migration for users who
  // recorded before this setting existed.
  maybeShowOnboarding () {
    if (this._settings.get_boolean('onboarding-shown')) { return false }

    if (this._hasExistingHistory?.()) {
      // Upgrading user: they already know the basics; mark silently.
      this._settings.set_boolean('onboarding-shown', true)
      return false
    }

    this._notifier.notify(
      'toas voice input is ready',
      'Hold the shortcut (default Ctrl+Shift+Space) or left-click the top-bar ' +
            'microphone to record; right-click for the menu. Audio is sent to ' +
            'your configured transcription service, and your words are kept ' +
            'locally (clear anytime from the menu).'
    )
    this._settings.set_boolean('onboarding-shown', true)
    return true
  }

  // Returns true when the user was warned and preferences were opened.
  guardUnconfigured (transcriptionReady) {
    if (transcriptionReady) { return false }

    this._notifier.notify(
      'toas is not configured yet',
      'Add your transcription API key in Preferences before recording.'
    )
    this._onOpenPreferences?.()
    return true
  }
}
