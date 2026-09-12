import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import IBus from 'gi://IBus'
import St from 'gi://St'
import * as IBusManager from 'resource:///org/gnome/shell/misc/ibusManager.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

const CLIPBOARD_CONFIRM_TIMEOUT_MS = 250
const CLIPBOARD_CONFIRM_POLL_MS = 20
const CLIPBOARD_RESTORE_DELAY_MS = 1000

// EVDEV hardware keycodes from <linux/input-event-codes.h>. Using hardware
// positions avoids notify_keyval() reverse-mapping failures under non-Latin
// keyboard layouts.
const KEY_LEFTCTRL = 29
const KEY_LEFTSHIFT = 42
const KEY_V = 47
const KEY_INSERT = 110

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

// Prefer direct input whenever one of GNOME's focused text-input paths can
// accept the complete result. Clutter.InputMethod.commit() accepts arbitrary
// strings, so ordinary text fields can receive multiline results directly.
// Standalone terminals keep multiline clipboard paste so their normal paste
// and bracketed-paste semantics remain intact.
export function selectOutputMethod({ text, autoPaste, directInputAvailable, terminal = false }) {
  const multilineTerminal = terminal && (text.includes('\n') || text.includes('\r'))
  return autoPaste && directInputAvailable && !multilineTerminal ? 'direct' : 'clipboard'
}

// Clipboard restoration is intentionally conditional. If another application
// or the user changed the clipboard while toas was pasting, restoring the old
// value would destroy that newer clipboard state.
export function shouldRestoreClipboard({ currentText, temporaryText, originalText }) {
  return originalText !== null && originalText !== temporaryText && currentText === temporaryText
}

class DirectTextInput {
  constructor() {
    this._ibusManager = IBusManager.getIBusManager()
    this._ibusFocused = false

    // Main.inputMethod covers Wayland clients. GNOME Shell's IBus panel service
    // sees X11/XWayland input contexts instead, so track those focus signals as
    // a second direct-input path. Starting false is deliberately conservative:
    // if the extension is enabled while an X11 field is already focused, the
    // first delivery falls back to the clipboard rather than risking a dropped
    // commit. The next IBus focus transition establishes the state.
    this._ibusManager?.connectObject?.(
      'focus-in', () => { this._ibusFocused = true },
      'focus-out', () => { this._ibusFocused = false },
      this
    )
  }

  available() {
    return Boolean(Main.inputMethod?.currentFocus) || this._ibusAvailable()
  }

  commit(text) {
    if (Main.inputMethod?.currentFocus) {
      Main.inputMethod.commit(text)
      return true
    }

    if (!this._ibusAvailable()) {
      return false
    }

    try {
      this._ibusManager._panelService.commit_text(IBus.Text.new_from_string(text))
      return true
    } catch (error) {
      console.warn(`[toas] IBus direct commit failed, using clipboard fallback: ${error.message}`)
      return false
    }
  }

  _ibusAvailable() {
    return Boolean(this._ibusFocused && this._ibusManager?._panelService?.commit_text)
  }

  destroy() {
    this._ibusManager?.disconnectObject?.(this)
    this._ibusManager = null
    this._ibusFocused = false
  }
}

// Delivers final text to the focused application: direct input-method/IBus
// commit when possible, otherwise a temporary clipboard transaction plus a
// synthesized paste shortcut. `_targetWindow` pins the captured target so a
// focus change during processing redirects to a clipboard-only delivery.
export class TextPaster {
  constructor(settings) {
    this._settings = settings
    this._clipboard = St.Clipboard.get_default()
    this._keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    this._directInput = new DirectTextInput()
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
      directInputAvailable: this._directInput.available(),
      terminal: isTerminalWindow(this._targetWindow ?? global.display.focus_window)
    })

    if (outputMethod === 'direct' && this._targetWindowMatches() && this._directInput.commit(text)) {
      this._targetWindow = null
      return { mode: 'inserted' }
    }

    // The original text value is restored after a successful automatic paste
    // when configured. Clipboard-only delivery intentionally leaves the result
    // on the clipboard because that is the configured deliverable.
    const originalText = await this._getClipboardText()
    if (this._cancelled || !this._clipboard || !this._keyboard) {
      return { mode: 'cancelled' }
    }

    const clipboardReady = await this._setClipboardAndConfirm(text)
    if (this._cancelled || !this._clipboard || !this._keyboard) {
      return { mode: 'cancelled' }
    }

    if (!autoPaste) {
      this._targetWindow = null
      return { mode: 'copied' }
    }

    // Never synthesize a paste until a read-back proves that the clipboard now
    // exposes this run's text. Otherwise the shortcut could paste stale content.
    if (!clipboardReady) {
      this._targetWindow = null
      throw new Error('Clipboard update could not be confirmed')
    }

    if (!this._targetWindowMatches()) {
      this._targetWindow = null
      return { mode: 'copied', reason: 'focus-mismatch' }
    }

    this._pasteShortcut()
    this._targetWindow = null

    if (this._settings.get_boolean('restore-clipboard')) {
      await delay(CLIPBOARD_RESTORE_DELAY_MS)
      if (this._cancelled || !this._clipboard) {
        return { mode: 'cancelled' }
      }

      const currentText = await this._getClipboardText()
      if (shouldRestoreClipboard({ currentText, temporaryText: text, originalText })) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, originalText)
      }
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

  // Presses hardware-keycode modifiers, taps the main key, then releases in
  // reverse order. Each event gets a fresh monotonic timestamp so ordering is
  // explicit even when the compositor handles the sequence asynchronously.
  _pasteShortcut() {
    const keys = isTerminalWindow(global.display.focus_window)
      ? [KEY_LEFTCTRL, KEY_LEFTSHIFT, KEY_V]
      : [KEY_LEFTSHIFT, KEY_INSERT]

    for (let i = 0; i < keys.length - 1; i++) {
      this._keyboard.notify_key(GLib.get_monotonic_time(), keys[i], Clutter.KeyState.PRESSED)
    }

    const mainKey = keys[keys.length - 1]
    this._keyboard.notify_key(GLib.get_monotonic_time(), mainKey, Clutter.KeyState.PRESSED)
    this._keyboard.notify_key(GLib.get_monotonic_time(), mainKey, Clutter.KeyState.RELEASED)

    for (let i = keys.length - 2; i >= 0; i--) {
      this._keyboard.notify_key(GLib.get_monotonic_time(), keys[i], Clutter.KeyState.RELEASED)
    }
  }

  async _setClipboardAndConfirm(text) {
    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)

    const deadline = GLib.get_monotonic_time() + CLIPBOARD_CONFIRM_TIMEOUT_MS * 1000
    while (GLib.get_monotonic_time() <= deadline) {
      if (await this._getClipboardText() === text) {
        return true
      }

      await delay(CLIPBOARD_CONFIRM_POLL_MS)
      if (this._cancelled || !this._clipboard) {
        return false
      }
    }

    return false
  }

  _getClipboardText() {
    return new Promise(resolve => {
      this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text ?? null))
    })
  }

  destroy() {
    this._directInput?.destroy()
    this._directInput = null
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
