import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import St from 'gi://St'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

export class ToasIndicator extends PanelMenu.Button {
  static {
    GObject.registerClass(this)
  }

  constructor ({ onToggle, onCancel, onClearHistory, onOpenPreferences }) {
    super(0.5, 'toas')

    this._onToggle = onToggle
    this._onCancel = onCancel
    this._onClearHistory = onClearHistory
    this._onOpenPreferences = onOpenPreferences

    // PanelMenu's built-in gesture opens the menu for every click. Route
    // mouse buttons explicitly so the primary action stays one click away.
    this._clickGesture?.set_enabled(false)

    this._icon = new St.Icon({
      icon_name: 'audio-input-microphone-symbolic',
      style_class: 'system-status-icon'
    })
    this.add_child(this._icon)

    this._toggleItem = new PopupMenu.PopupMenuItem('Start voice input')
    this._toggleIcon = addMenuIcon(
      this._toggleItem,
      'media-record-symbolic'
    )
    this._toggleItem.connect('activate', () => this._onToggle?.())
    this.menu.addMenuItem(this._toggleItem)

    this._cancelItem = new PopupMenu.PopupMenuItem('Cancel')
    addMenuIcon(this._cancelItem, 'process-stop-symbolic')
    this._cancelItem.connect('activate', () => this._onCancel?.())
    this.menu.addMenuItem(this._cancelItem)

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

    this._clearHistoryItem = new PopupMenu.PopupMenuItem('Clear History')
    addMenuIcon(this._clearHistoryItem, 'edit-clear-all-symbolic')
    this._clearHistoryItem.connect('activate', () => {
      this.menu.close()
      this._onClearHistory?.()
    })
    this.menu.addMenuItem(this._clearHistoryItem)

    const settingsItem = new PopupMenu.PopupMenuItem('Settings')
    addMenuIcon(settingsItem, 'preferences-system-symbolic')
    settingsItem.connect('activate', () => {
      this.menu.close()
      this._onOpenPreferences?.()
    })
    this.menu.addMenuItem(settingsItem)

    this.render('idle')
  }

  _onButtonPress (event) {
    const button = event.get_button()

    if (button === Clutter.BUTTON_PRIMARY) {
      this.menu.close()
      this._onToggle?.()
      return Clutter.EVENT_STOP
    }

    if (button === Clutter.BUTTON_SECONDARY) {
      this.menu.toggle()
      return Clutter.EVENT_STOP
    }

    return Clutter.EVENT_PROPAGATE
  }

  vfunc_event (event) {
    const type = event.type()

    if (type === Clutter.EventType.BUTTON_PRESS) { return this._onButtonPress(event) }

    if (type === Clutter.EventType.TOUCH_BEGIN) {
      this.menu.toggle()
      return Clutter.EVENT_STOP
    }

    // St.Widget does not implement the event vfunc in GNOME 50, so
    // propagating must be expressed directly instead of calling super.
    return Clutter.EVENT_PROPAGATE
  }

  render (state) {
    const recording = state === 'recording'
    const idle = state === 'idle' || state === 'error'

    this._icon.icon_name = recording
      ? 'media-record-symbolic'
      : 'audio-input-microphone-symbolic'

    if (recording) { this.add_style_class_name('screen-recording-indicator') } else { this.remove_style_class_name('screen-recording-indicator') }

    this._toggleItem.label.text = recording
      ? 'Stop and process'
      : 'Start voice input'
    this._toggleIcon.icon_name = recording
      ? 'media-playback-stop-symbolic'
      : 'media-record-symbolic'
    this._toggleItem.setSensitive(idle || recording)
    this._cancelItem.visible = !idle && state !== 'outputting'
    this._clearHistoryItem.setSensitive(idle)
  }

  destroy () {
    this._onToggle = null
    this._onCancel = null
    this._onClearHistory = null
    this._onOpenPreferences = null
    super.destroy()
  }
}

function addMenuIcon (item, iconName) {
  const icon = new St.Icon({
    icon_name: iconName,
    style_class: 'toas-menu-icon',
    y_align: Clutter.ActorAlign.CENTER
  })
  item.insert_child_at_index(icon, 0)
  return icon
}
