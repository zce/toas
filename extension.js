import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import St from 'gi://St'

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { HistoryRepository, HistoryStore, extractText } from './host/history.js'
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
      const history = new HistoryStore(this._settings)
      this._historyStore = history
      const notifier = new ShellNotifier()
      this._historyRepository = new HistoryRepository(history)
      this._historyClipboard = St.Clipboard.get_default()

      // Session-level privacy state; deliberately not persisted so a restart
      // always returns to normal retention.
      this._privacy = { enabled: false }

      this._indicator = new ToasIndicator({
        onToggle: () => {
          if (this._guardReadyToRecord()) { this._orchestrator?.toggle() }
        },
        onClearHistory: () => this._clearHistory(),
        onOpenPreferences: () => this._openPreferences(),
        onListHistory: () => this._listHistory(),
        onCopySession: entry => this._copySession(entry, notifier),
        onRetrySession: entry => this._retrySession(entry, notifier),
        onCanRetrySession: entry =>
          this._historyRepository.resolveAudio(entry).available,
        onPrivateModeChanged: enabled => this._setPrivateMode(enabled)
      })

      this._overlay = new ToasOverlayPresenter({ view: new ShellOverlayView() })

      const kernelRunner = new KernelRunner({ settings: this._settings })
      this._kernelRunner = kernelRunner

      this._orchestrator = new ToasOrchestrator({
        settings: this._settings,
        historyRepository: this._historyRepository,
        collaborators: {
          overlay: this._overlay,
          history,
          paster: new TextPaster(this._settings),
          notifier,
          privacy: this._privacy,
          kernel: kernelRunner
        },
        onStateChanged: (state, message) => this._indicator?.render(state, message)
      })

      this._overlay.setOnCancelRequested?.(() => this._orchestrator?.cancel())

      this._onboarding = new OnboardingManager({
        settings: this._settings,
        notifier,
        onOpenPreferences: () => this._openPreferences(),
        hasExistingHistory: () => history.readEntries().length > 0
      })
      this._onboarding.maybeShowOnboarding()

      try {
        this._confirmDialog = new ConfirmDialog({
          title: 'Clear your words?',
          description: 'Your words and retained recordings will be ' +
            'permanently deleted. This cannot be undone.',
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
      this._inputBinding?.destroy()
      this._inputBinding = null

      this._orchestrator?.destroy()
      this._orchestrator = null

      this._kernelRunner?.destroy()
      this._kernelRunner = null

      this._overlay?.destroy()
      this._overlay = null

      this._confirmDialog?.destroy()
      this._confirmDialog = null

      this._indicator?.destroy()
      this._indicator = null

      this._historyStore?.destroy()
      this._historyStore = null

      this._settings = null

      throw error
    }
  }

  disable () {
    this._inputBinding?.destroy()
    this._inputBinding = null

    this._privacy = null

    this._orchestrator?.destroy()
    this._orchestrator = null

    this._kernelRunner?.destroy()
    this._kernelRunner = null

    this._onboarding = null
    this._historyRepository = null
    this._historyClipboard = null

    // Destroying the dialog releases its modal grab.
    this._confirmDialog?.destroy()
    this._confirmDialog = null

    // The orchestrator drops collaborator references without destroying them;
    // the composition root owns their teardown.
    this._overlay?.destroy()
    this._overlay = null

    this._indicator?.destroy()
    this._indicator = null

    this._historyStore?.destroy()
    this._historyStore = null

    this._settings = null
  }

  // Gate for every recording entry point (shortcut and top-bar). Returns
  // false when the user was redirected to preferences instead.
  _guardReadyToRecord () {
    const ready = this._kernelRunner?.configService?.primaryReady() ?? false
    return !this._onboarding.guardUnconfigured(ready)
  }

  _setPrivateMode (enabled) {
    if (!this._privacy) { return }

    this._privacy.enabled = Boolean(enabled)
    // Only the panel icon reflects the live switch; the overlay decoration
    // rides the run snapshot, driven solely by the orchestrator.
    this._indicator?.setPrivateMode(enabled)
  }

  _clearHistory () {
    // Confirmation is mandatory; without the dialog, do nothing rather than
    // silently bypassing it.
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
    return this._historyRepository.list({ limit: 30 }).map(entry => {
      const attempts = this._historyRepository.attemptsOf(entry.id)
      const latest = attempts[attempts.length - 1]
      if (!latest) { return entry }

      return {
        ...entry,
        status: latest.status,
        text: latest.text ?? entry.text,
        attemptNumber: latest.attemptNumber
      }
    })
  }

  async _retrySession (entry, notifier) {
    this._indicator?.menu.close()
    notifier.notify('Trying again', 'Processing the retained recording again.')
    const attempt = await this._orchestrator?.retry(entry)

    if (attempt?.status === 'ok') {
      notifier.notify('Retry succeeded', 'Open the menu to copy the new result.')
    } else if (attempt?.status === 'error') {
      notifier.notify(
        'Retry failed',
        attempt.error?.message ?? 'It failed again.'
      )
    }
  }

  _openPreferences () {
    // GNOME 50's Extension.openPreferences() does not consume this async
    // result, producing an unhandled rejection when the process fails.
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
