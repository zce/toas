import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

// Window classes of standalone terminals, matched as substrings against the
// usual WM identifiers. IDE-embedded terminals do not honor these hints.
const TERMINAL_HINTS = [
  'ptyxis',
  'ghostty',
  'gnome-terminal',
  'gnome-terminal-server',
  'kgx',
  'console',
  'konsole',
  'alacritty',
  'kitty',
  'wezterm',
  'foot',
  'tilix'
]

export function isTerminalWindow(window) {
  if (!window) {
    return false
  }

  const identifiers = [window.get_wm_class?.(), window.get_wm_class_instance?.(), window.get_gtk_application_id?.(), window.get_sandboxed_app_id?.()]
    .filter(Boolean)
    .map(value => value.toLowerCase())

  return identifiers.some(identifier => TERMINAL_HINTS.some(hint => identifier.includes(hint)))
}

// Direct input commits exactly what was captured, so it only handles
// single-line text; anything multiline goes through the clipboard.
export function selectOutputMethod({ text, autoPaste, directInputAvailable }) {
  if (autoPaste && directInputAvailable && !text.includes('\n') && !text.includes('\r')) {
    return 'direct'
  }

  return 'clipboard'
}

// Delivers final text to the focused application: direct input-method commit
// when possible, otherwise clipboard write plus a synthesized paste shortcut
// through a virtual keyboard. `_targetWindow` pins the captured target so a
// focus change during processing redirects to a clipboard-only delivery.
export class TextPaster {
  constructor(settings) {
    this._settings = settings
    this._clipboard = St.Clipboard.get_default()
    this._keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    this._cancelled = false
    this._targetWindow = null
  }

  getFocusedMonitorIndex() {
    try {
      const monitorIndex = global.display.focus_window?.get_monitor?.()
      return Number.isInteger(monitorIndex) && monitorIndex >= 0 ? monitorIndex : null
    } catch {
      return null
    }
  }

  captureFocusedWindow() {
    this._targetWindow = global.display.focus_window
    return this._targetWindow
  }

  async write(text) {
    if (!text?.trim()) {
      return { mode: 'none' }
    }

    this._cancelled = false
    const autoPaste = this._settings.get_boolean('auto-paste')
    const outputMethod = selectOutputMethod({
      text,
      autoPaste,
      directInputAvailable: Boolean(Main.inputMethod?.currentFocus)
    })

    if (outputMethod === 'direct' && this._targetWindowMatches()) {
      Main.inputMethod.commit(text)
      this._targetWindow = null
      return { mode: 'inserted' }
    }

    // The original value is restored after pasting when configured.
    const originalText = await this._getClipboardText()
    if (this._cancelled || !this._clipboard || !this._keyboard) {
      return { mode: 'cancelled' }
    }

    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
    // Give the target application a beat to observe the clipboard change
    // before the synthesized paste fires.
    await delay(70)

    if (this._cancelled || !this._clipboard || !this._keyboard) {
      return { mode: 'cancelled' }
    }

    if (!autoPaste) {
      this._targetWindow = null
      return { mode: 'copied' }
    }

    if (!this._targetWindowMatches()) {
      this._targetWindow = null
      return { mode: 'copied', reason: 'focus-mismatch' }
    }

    this._pasteShortcut()
    this._targetWindow = null

    if (this._settings.get_boolean('restore-clipboard') && originalText !== null && originalText !== text) {
      await delay(450)
      if (this._cancelled) {
        return { mode: 'cancelled' }
      }
      this._clipboard?.set_text(St.ClipboardType.CLIPBOARD, originalText)
    }

    return { mode: 'inserted' }
  }

  // No captured target means nothing to compare against; delivery proceeds.
  _targetWindowMatches() {
    if (!this._targetWindow) {
      return true
    }
    const focused = global.display.focus_window
    return Boolean(focused) && focused === this._targetWindow
  }

  cancel() {
    this._cancelled = true
  }

  // Presses modifiers, taps the main key, then releases in reverse order.
  _pasteShortcut() {
    const keys = isTerminalWindow(global.display.focus_window)
      ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
      : [Clutter.KEY_Shift_L, Clutter.KEY_Insert]

    const now = GLib.get_monotonic_time()

    for (let i = 0; i < keys.length - 1; i++) {
      this._keyboard.notify_keyval(now, keys[i], Clutter.KeyState.PRESSED)
    }

    const mainKey = keys[keys.length - 1]
    this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.PRESSED)
    this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.RELEASED)

    for (let i = keys.length - 2; i >= 0; i--) {
      this._keyboard.notify_keyval(now, keys[i], Clutter.KeyState.RELEASED)
    }
  }

  _getClipboardText() {
    return new Promise(resolve => {
      this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text ?? null))
    })
  }

  destroy() {
    this._keyboard?.run_dispose()
    this._keyboard = null
    this._clipboard = null
  }
}

function delay(ms) {
  return new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    })
  })
}
