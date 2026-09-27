import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import IBus from 'gi://IBus'
import St from 'gi://St'
import * as IBusManager from 'resource:///org/gnome/shell/misc/ibusManager.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

// EVDEV hardware keycodes from <linux/input-event-codes.h>.
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

// Multiline terminal output stays on the paste path to preserve terminal paste semantics.
export function selectOutputMethod({ text, autoPaste, directInputAvailable, terminal = false }) {
  const multilineTerminal = terminal && (text.includes('\n') || text.includes('\r'))
  return autoPaste && directInputAvailable && !multilineTerminal ? 'direct' : 'clipboard'
}

// Delivers final text to the focused application: direct input-method/IBus
// commit when possible, otherwise clipboard write plus a synthesized paste
// shortcut. `_targetWindow` pins the captured target so a focus change during
// processing redirects to a clipboard-only delivery.
export class TextPaster {
  constructor(settings) {
    this._settings = settings
    this._clipboard = St.Clipboard.get_default()
    this._keyboard = null
    this._ibusManager = IBusManager.getIBusManager()
    this._ibusFocused = false
    this._cancelled = false
    this._targetWindow = null

    this._ibusManager.connectObject(
      'focus-in', () => { this._ibusFocused = true },
      'focus-out', () => { this._ibusFocused = false },
      this
    )
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
    if (autoPaste && this._targetWindowMatches()) {
      const directInputAvailable = Boolean(
        Main.inputMethod?.currentFocus ||
        (this._ibusFocused && this._ibusManager._panelService)
      )
      const outputMethod = selectOutputMethod({
        text,
        autoPaste,
        directInputAvailable,
        terminal: isTerminalWindow(this._targetWindow)
      })
      if (outputMethod === 'direct' && this._commitDirect(text)) {
        this._targetWindow = null
        return { mode: 'inserted' }
      }
    }

    if (this._cancelled || !this._clipboard) {
      return { mode: 'cancelled' }
    }

    // Copy-only delivery must not depend on reading the old clipboard or
    // creating a virtual keyboard. An absent original target also copies.
    if (!autoPaste || !this._targetWindowMatches()) {
      this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
      this._targetWindow = null
      return autoPaste ? { mode: 'copied', reason: 'focus-mismatch' } : { mode: 'copied' }
    }

    const restoreClipboard = this._settings.get_boolean('restore-clipboard')
    const originalText = restoreClipboard ? await this._getClipboardText() : null
    if (this._cancelled || !this._clipboard) {
      return { mode: 'cancelled' }
    }

    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
    if (this._cancelled || !this._clipboard) {
      return { mode: 'cancelled' }
    }

    // Focus can change across either asynchronous clipboard read. Never
    // synthesize a paste shortcut into a window other than the captured one.
    if (!this._targetWindowMatches()) {
      this._targetWindow = null
      return { mode: 'copied', reason: 'focus-mismatch' }
    }

    if (await this._getClipboardText() !== text) {
      this._targetWindow = null
      throw new Error('Clipboard update could not be confirmed')
    }
    if (this._cancelled || !this._clipboard) {
      return { mode: 'cancelled' }
    }
    if (!this._targetWindowMatches()) {
      this._targetWindow = null
      return { mode: 'copied', reason: 'focus-mismatch' }
    }

    this._pasteShortcut()
    this._targetWindow = null

    if (restoreClipboard && originalText !== null && originalText !== text) {
      await delay(1000)
      if (this._cancelled || !this._clipboard) {
        return { mode: 'cancelled' }
      }

      if (await this._getClipboardText() === text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, originalText)
      }
    }

    return { mode: 'inserted' }
  }

  _commitDirect(text) {
    if (Main.inputMethod?.currentFocus) {
      Main.inputMethod.commit(text)
      return true
    }

    if (!this._ibusFocused || !this._ibusManager._panelService) {
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

  _targetWindowMatches() {
    return Boolean(this._targetWindow) && global.display.focus_window === this._targetWindow
  }

  cancel() {
    this._cancelled = true
  }

  _pasteShortcut() {
    this._keyboard ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    const keys = isTerminalWindow(this._targetWindow)
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

  _getClipboardText() {
    return new Promise(resolve => {
      this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => resolve(text ?? null))
    })
  }

  destroy() {
    this._ibusManager.disconnectObject(this)
    this._ibusManager = null
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
