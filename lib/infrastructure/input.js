import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import St from 'gi://St'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

import { selectOutputMethod } from '../domain/output-strategy.js'
import { isTerminalWindow } from '../domain/window-role.js'

export class TextPaster {
  constructor (settings) {
    this._settings = settings
    this._clipboard = St.Clipboard.get_default()
    this._keyboard = Clutter.get_default_backend()
      .get_default_seat()
      .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    this._cancelled = false
    this._targetWindow = null
  }

  // Captures the currently focused window as the paste target.
  captureFocusedWindow () {
    this._targetWindow = global.display.focus_window
    return this._targetWindow
  }

  async write (text) {
    if (!text?.trim()) { return }

    this._cancelled = false

    const autoPaste = this._settings.get_boolean('auto-paste')
    const outputMethod = selectOutputMethod({
      text,
      autoPaste,
      directInputAvailable: Boolean(Main.inputMethod?.currentFocus)
    })

    // Direct commit is synchronous, so focus cannot change between the guard
    // and insertion. Multiline text deliberately uses clipboard paste so
    // terminals retain bracketed-paste protection.
    if (outputMethod === 'direct' && this._targetWindowMatches()) {
      Main.inputMethod.commit(text)
      this._targetWindow = null
      return
    }

    const originalText = await this._getClipboardText()
    if (this._cancelled || !this._clipboard || !this._keyboard) { return }

    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
    await delay(70)

    // Past this point the paste key events are irreversible.
    if (this._cancelled || !this._clipboard || !this._keyboard) { return }

    // Clipboard-only mode: the text is the deliverable. Skip the paste
    // keypresses entirely and keep the clipboard as the user left it.
    if (!autoPaste) {
      this._targetWindow = null
      this._onFocusMismatch?.(
        'Voice text is on the clipboard — automatic paste is off.'
      )
      return
    }

    // Window-level safeguard: if the user moved to another window while the
    // pipeline ran, paste would land in the wrong application. Keep the text
    // on the clipboard instead; this says nothing about focus changes within
    // the same window.
    if (!this._targetWindowMatches()) {
      this._onFocusMismatch?.(
        'Voice text was copied to the clipboard — the target window changed while processing.'
      )
      this._targetWindow = null
      return
    }

    this._pasteShortcut()
    this._targetWindow = null

    if (
      this._settings.get_boolean('restore-clipboard') &&
            originalText !== null &&
            originalText !== text
    ) {
      await delay(450)
      if (this._cancelled) { return }
      this._clipboard?.set_text(St.ClipboardType.CLIPBOARD, originalText)
    }
  }

  _targetWindowMatches () {
    if (!this._targetWindow) {
      // No target captured (for example clipboard-only callers): treat as
      // matched so direct writes keep working.
      return true
    }

    const focused = global.display.focus_window
    return Boolean(focused) && focused === this._targetWindow
  }

  setOnFocusMismatch (handler) {
    this._onFocusMismatch = handler
  }

  cancel () {
    this._cancelled = true
  }

  _pasteShortcut () {
    // Terminal Shift+Insert commonly pastes PRIMARY selection rather than the
    // clipboard populated above. Known terminal windows need Ctrl+Shift+V.
    const keys = isTerminalWindow(global.display.focus_window)
      ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
      : [Clutter.KEY_Shift_L, Clutter.KEY_Insert]

    const now = GLib.get_monotonic_time()

    for (let i = 0; i < keys.length - 1; i++) {
      this._keyboard.notify_keyval(
        now,
        keys[i],
        Clutter.KeyState.PRESSED
      )
    }

    const mainKey = keys[keys.length - 1]
    this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.PRESSED)
    this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.RELEASED)

    for (let i = keys.length - 2; i >= 0; i--) {
      this._keyboard.notify_keyval(
        now,
        keys[i],
        Clutter.KeyState.RELEASED
      )
    }
  }

  _getClipboardText () {
    return new Promise(resolve => {
      this._clipboard.get_text(
        St.ClipboardType.CLIPBOARD,
        (_clipboard, text) => resolve(text ?? null)
      )
    })
  }

  destroy () {
    this._keyboard?.run_dispose()
    this._keyboard = null
    this._clipboard = null
  }
}

function delay (ms) {
  return new Promise(resolve => {
    GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      ms,
      () => {
        resolve()
        return GLib.SOURCE_REMOVE
      }
    )
  })
}
