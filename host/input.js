import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

const MODIFIER_MASK =
  Clutter.ModifierType.CONTROL_MASK |
  Clutter.ModifierType.SHIFT_MASK |
  Clutter.ModifierType.MOD1_MASK |
  Clutter.ModifierType.SUPER_MASK

const POLL_INTERVAL_MS = 40

export class PushToTalkBinding {
  constructor ({ settings, canStart, onToggle, onBegin, onEnd }) {
    this._settings = settings
    this._canStart = canStart
    this._onToggle = onToggle
    this._onBegin = onBegin
    this._onEnd = onEnd
    this._pollId = 0
    this._enabled = false
  }

  enable () {
    if (this._enabled) { return }

    Main.wm.addKeybinding(
      'push-to-talk',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => this._activate()
    )
    this._enabled = true
  }

  _activate () {
    if (this._pollId) { return }

    const heldModifiers = global.get_pointer()[2] & MODIFIER_MASK

    // GNOME's keybinding callback only gives us the press. With no modifier
    // there is no cheap/reliable release signal, so degrade to toggle mode.
    if (heldModifiers === 0) {
      if (this._canStart()) { this._onToggle?.() }
      return
    }

    if (!this._canStart()) { return }

    this._onBegin?.()

    this._pollId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      POLL_INTERVAL_MS,
      () => {
        const modifiers = global.get_pointer()[2]

        if ((modifiers & heldModifiers) !== 0) {
          return GLib.SOURCE_CONTINUE
        }

        this._pollId = 0
        this._onEnd?.()
        return GLib.SOURCE_REMOVE
      }
    )
  }

  destroy () {
    if (this._pollId) {
      GLib.source_remove(this._pollId)
      this._pollId = 0
    }

    if (this._enabled) {
      Main.wm.removeKeybinding('push-to-talk')
      this._enabled = false
    }

    this._settings = null
    this._canStart = null
    this._onToggle = null
    this._onBegin = null
    this._onEnd = null
  }
}
