import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import St from 'gi://St'

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

    const originalText = await this._getClipboardText()
    if (this._cancelled || !this._clipboard || !this._keyboard) { return }

    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
    await delay(70)

    // Past this point the paste key events are irreversible.
    if (this._cancelled || !this._clipboard || !this._keyboard) { return }

    // Clipboard-only mode: the text is the deliverable. Skip the paste
    // keypresses entirely and keep the clipboard as the user left it.
    if (!this._settings.get_boolean('auto-paste')) {
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
    // Shift+Insert is the common Linux clipboard-paste binding in editors,
    // terminals, and IDE-embedded terminals. Unlike Ctrl+V vs Ctrl+Shift+V,
    // it does not require guessing the focused widget from the window class.
    const keys = [Clutter.KEY_Shift_L, Clutter.KEY_Insert]

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
