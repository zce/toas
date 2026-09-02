import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import St from 'gi://St'

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { ToasIndicator } from './lib/indicator.js'
import { ToasOrchestrator } from './lib/orchestrator.js'
import { ToasOverlayPresenter } from './lib/overlay-presenter.js'
import { ShellOverlayView } from './lib/shell-overlay-view.js'
import { ShellNotifier } from './lib/notifier.js'
import { TextPaster } from './lib/input.js'
import { HistoryStore } from './lib/history.js'
import { HistoryRepository } from './lib/history-repository.js'
import { OnboardingManager } from './lib/onboarding.js'
import { ConfirmDialog } from './lib/confirm-dialog.js'
import { resolveTranscriptionConfig } from './lib/effective-config.js'

const PTT_MOD_MASK =
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.SHIFT_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SUPER_MASK

const PTT_POLL_INTERVAL_MS = 40

export default class ToasExtension extends Extension {
  enable () {
    try {
      this._settings = this.getSettings()
      const history = new HistoryStore(this._settings)
      this._historyStore = history
      const notifier = new ShellNotifier()
      this._historyRepository = new HistoryRepository(history)
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
        onCanRetrySession: entry =>
          this._historyRepository.resolveAudio(entry).available
      })
      const overlay = new ToasOverlayPresenter({ view: new ShellOverlayView() })
      this._overlayCollaborators = { overlay }

      this._orchestrator = new ToasOrchestrator({
        settings: this._settings,
        historyRepository: this._historyRepository,
        collaborators: {
          overlay,
          history,
          paster: new TextPaster(this._settings),
          notifier
        },
        onStateChanged: (state, message) => this._indicator?.render(state, message)
      })

      // Overlay close button cancels the live session directly.
      overlay.setOnCancelRequested?.(() => this._orchestrator?.cancel())

      this._onboarding = new OnboardingManager({
        settings: this._settings,
        notifier,
        onOpenPreferences: () => this._openPreferences(),
        hasExistingHistory: () => history.readEntries().length > 0
      })
      this._onboarding.maybeShowOnboarding()

      try {
        this._confirmDialog = new ConfirmDialog({
          title: 'Clear voice history?',
          description: 'All session text and retained recordings will be ' +
                        'permanently deleted. This cannot be undone.',
          confirmLabel: 'Clear',
          onConfirm: () => this._doClearHistory()
        })
      } catch (dialogError) {
        console.error(`[toas] Could not create confirm dialog: ${dialogError.message}`)
        this._confirmDialog = null
      }

      Main.panel.addToStatusArea(this.uuid, this._indicator)
      this._scheduleIndicatorPosition();

      Main.wm.addKeybinding(
        'push-to-talk',
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => this._onPushToTalk()
      )
    } catch (error) {
      this._destroyIndicatorPosition();

      this._orchestrator?.destroy()
      this._orchestrator = null

      this._overlayCollaborators?.overlay?.destroy()
      this._overlayCollaborators = null

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
    this._destroyIndicatorPosition();

    if (this._pttPollId) {
      GLib.source_remove(this._pttPollId)
      this._pttPollId = 0
    }

    Main.wm.removeKeybinding('push-to-talk')

    this._orchestrator?.destroy()
    this._orchestrator = null

    this._onboarding = null
    this._historyRepository = null
    this._historyClipboard = null

    // Destroying the dialog releases its modal grab.
    this._confirmDialog?.destroy()
    this._confirmDialog = null

    // The orchestrator drops collaborator references without destroying them;
    // the composition root owns their teardown.
    this._overlayCollaborators?.overlay?.destroy()
    this._overlayCollaborators = null

    this._indicator?.destroy()
    this._indicator = null

    this._historyStore?.destroy()
    this._historyStore = null

    this._settings = null
  }

  _scheduleIndicatorPosition() {
    this._positionIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._positionIdleId = 0;
      this._positionIndicator();
      return GLib.SOURCE_REMOVE;
    });
  }

  _positionIndicator() {
    const indicator = this._indicator?.container;
    const keyboard = Main.panel.statusArea.keyboard?.container;

    if (!indicator || !keyboard) {
      return;
    }

    const parent = keyboard.get_parent();

    if (!parent || indicator.get_parent() !== parent) {
      return;
    }

    parent.set_child_below_sibling(indicator, keyboard);
  }

  _destroyIndicatorPosition() {
    if (!this._positionIdleId) {
      return;
    }

    GLib.source_remove(this._positionIdleId);
    this._positionIdleId = 0;
  }

  // Gate for every recording entry point (shortcut and top-bar). Returns
  // false when the user was redirected to preferences instead.
  _guardReadyToRecord () {
    const ready = resolveTranscriptionConfig(this._settings).ready
    return !this._onboarding.guardUnconfigured(ready)
  }

  _onPushToTalk () {
    if (this._pttPollId) { return }

    const heldModifiers = global.get_pointer()[2] & PTT_MOD_MASK

    // GNOME's keybinding callback only gives us the press. With no modifier
    // there is no cheap/reliable release signal, so degrade to toggle mode.
    if (heldModifiers === 0) {
      if (this._guardReadyToRecord()) { this._orchestrator?.toggle() }
      return
    }

    if (!this._guardReadyToRecord()) { return }

    this._orchestrator?.begin()

    this._pttPollId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      PTT_POLL_INTERVAL_MS,
      () => {
        const modifiers = global.get_pointer()[2]

        if ((modifiers & heldModifiers) !== 0) {
          return GLib.SOURCE_CONTINUE;
        }

        this._pttPollId = 0
        this._orchestrator?.end()
        return GLib.SOURCE_REMOVE
      }
    )
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
        ? `Cleared ${cleared} voice session${cleared === 1 ? '' : 's'}`
        : 'History is already empty'
    )
  }

  _copySession (entry, notifier) {
    const text = entry.output || entry.transcript || ''
    if (!text) { return }

    this._historyClipboard?.set_text(St.ClipboardType.CLIPBOARD, text)
    notifier.notify('Copied', 'Session text is on the clipboard.')
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
        transcript: latest.transcript ?? entry.transcript,
        output: latest.output ?? entry.output,
        attemptNumber: latest.attemptNumber
      }
    })
  }

  async _retrySession (entry, notifier) {
    this._indicator?.menu.close()
    notifier.notify('Retrying session', 'Processing the retained recording again.')
    const attempt = await this._orchestrator?.retry(entry)

    if (attempt?.status === 'ok') {
      notifier.notify('Retry succeeded', 'Open the menu to copy the new result.')
    } else if (attempt?.status === 'error') {
      notifier.notify(
        'Retry failed',
        attempt.error?.message ?? 'The session failed again.'
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
