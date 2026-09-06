import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import St from 'gi://St'

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { presentFailure } from './host/feedback.js'
import { HistoryStore, extractText } from './host/history.js'
import { PushToTalkBinding } from './host/input.js'
import { OnboardingManager } from './host/onboarding.js'
import { ToasOrchestrator } from './host/orchestrator.js'
import { TextPaster } from './host/output.js'
import { KernelRunner } from './host/runner.js'
import { ConfirmDialog } from './ui/dialog.js'
import { ToasIndicator } from './ui/indicator.js'
import { ShellNotifier } from './ui/notifier.js'
import { ShellOverlayView, ToasOverlayPresenter } from './ui/overlay.js'

export default class ToasExtension extends Extension {
  enable () {
    try {
      this._settings = this.getSettings()
      this._history = new HistoryStore(this._settings)
      const notifier = new ShellNotifier()
      this._historyClipboard = St.Clipboard.get_default()

      this._indicator = new ToasIndicator({
        onToggle: () => {
          if (this._guardReadyToRecord()) { this._orchestrator?.toggle() }
        },
        onClearHistory: () => this._clearHistory(),
        onOpenPreferences: () => this._openPreferences(),
        onListHistory: () => this._listHistory(),
        onCopySession: entry => this._copySession(entry, notifier),
        onRetrySession: entry => this._retrySession(entry, notifier),
        onCanRetrySession: entry => this._history.resolveAudio(entry).available,
        onPrivateModeChanged: enabled => this._setPrivateMode(enabled)
      })
      this._privateModeChangedId = this._settings.connect(
        'changed::private-mode',
        () => this._indicator?.setPrivateMode(this._settings.get_boolean('private-mode'))
      )
      this._indicator.setPrivateMode(this._settings.get_boolean('private-mode'))

      this._overlay = new ToasOverlayPresenter({ view: new ShellOverlayView() })
      this._kernelRunner = new KernelRunner({ settings: this._settings })
      this._output = new TextPaster(this._settings)

      this._orchestrator = new ToasOrchestrator({
        settings: this._settings,
        history: this._history,
        kernel: this._kernelRunner,
        output: this._output,
        overlay: this._overlay,
        notifier,
        onStateChanged: (state, message) => this._indicator?.render(state, message)
      })

      this._overlay.setOnCancelRequested?.(() => this._orchestrator?.cancel())

      this._onboarding = new OnboardingManager({
        settings: this._settings,
        notifier,
        onOpenPreferences: () => this._openPreferences(),
        hasExistingHistory: () => this._history.list({ limit: 1 }).length > 0
      })
      this._onboarding.maybeShowOnboarding(this._kernelRunner.primaryReady())

      try {
        this._confirmDialog = new ConfirmDialog({
          title: 'Clear local history?',
          description: 'Delete saved text and recordings from this device. This cannot be undone.',
          confirmLabel: 'Clear',
          onConfirm: () => this._doClearHistory()
        })
      } catch (dialogError) {
        console.error(`[toas] Could not create confirm dialog: ${dialogError.message}`)
        this._confirmDialog = null
      }

      this._indicator.addToPanel(this.uuid)

      this._inputBinding = new PushToTalkBinding({
        settings: this._settings,
        canStart: () => this._guardReadyToRecord(),
        onToggle: () => this._orchestrator?.toggle(),
        onBegin: () => this._orchestrator?.begin(),
        onEnd: () => this._orchestrator?.end()
      })
      this._inputBinding.enable()
    } catch (error) {
      this._teardown()
      throw error
    }
  }

  disable () {
    this._teardown()
  }

  _teardown () {
    this._inputBinding?.destroy()
    this._inputBinding = null

    if (this._privateModeChangedId && this._settings) {
      this._settings.disconnect(this._privateModeChangedId)
    }
    this._privateModeChangedId = 0

    this._orchestrator?.destroy()
    this._orchestrator = null

    this._kernelRunner?.destroy()
    this._kernelRunner = null

    this._onboarding = null
    this._historyClipboard = null

    this._confirmDialog?.destroy()
    this._confirmDialog = null

    this._output?.destroy()
    this._output = null

    this._overlay?.destroy()
    this._overlay = null

    this._indicator?.destroy()
    this._indicator = null

    this._history?.destroy()
    this._history = null
    this._settings = null
  }

  _guardReadyToRecord () {
    const ready = this._kernelRunner?.primaryReady() ?? false
    return !this._onboarding.guardUnconfigured(ready)
  }

  _setPrivateMode (enabled) {
    this._settings?.set_boolean('private-mode', Boolean(enabled))
  }

  _clearHistory () {
    if (this._confirmDialog) {
      this._confirmDialog.open(global.get_current_time())
    }
  }

  _doClearHistory () {
    const cleared = this._orchestrator?.clearHistory()
    if (cleared === null || cleared === undefined) { return }

    Main.notify(
      cleared > 0
        ? `Cleared ${cleared} item${cleared === 1 ? '' : 's'}`
        : 'History is already empty'
    )
  }

  _copySession (entry, notifier) {
    const text = extractText(entry)
    if (!text) { return }

    this._historyClipboard?.set_text(St.ClipboardType.CLIPBOARD, text)
    notifier.notify('Copied', 'Your words are on the clipboard.')
    this._indicator?.menu.close()
  }

  _listHistory () {
    return this._history.list({ limit: 30 })
  }

  async _retrySession (entry, notifier) {
    this._indicator?.menu.close()
    notifier.notify('Trying again', 'Processing the retained recording again.')
    const attempt = await this._orchestrator?.retry(entry)

    if (attempt?.status === 'ok') {
      notifier.notify('Retry succeeded', 'Open the menu to copy the new result.')
    } else if (attempt?.status === 'error') {
      const presentation = presentFailure(attempt.error, attempt.error?.stage)
      notifier.notify(
        'Retry failed',
        presentation
          ? `${presentation.summary}. ${presentation.guidance}`
          : 'Try again.'
      )
    }
  }

  _openPreferences () {
    // GNOME 50's Extension.openPreferences() does not consume its async result,
    // so use the Shell D-Bus method directly to avoid an unhandled rejection.
    Gio.DBus.session.call(
      'org.gnome.Shell.Extensions',
      '/org/gnome/Shell/Extensions',
      'org.gnome.Shell.Extensions',
      'OpenExtensionPrefs',
      new GLib.Variant('(ssa{sv})', [this.uuid, '', {}]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (_connection, result) => {
        try {
          Gio.DBus.session.call_finish(result)
        } catch (error) {
          console.error(`[toas] Failed to open preferences: ${error.message}`)
        }
      }
    )
  }
}
