import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import Pango from 'gi://Pango'
import St from 'gi://St'

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'

import { formatDuration, formatRelativeTime, previewText } from '../host/history.js'

export class ToasIndicator extends PanelMenu.Button {
  static {
    GObject.registerClass(this)
  }

  constructor ({
    onToggle,
    onClearHistory,
    onOpenPreferences,
    onListHistory,
    onCopySession,
    onRetrySession,
    onCanRetrySession,
    onPrivateModeChanged
  }) {
    super(0.5, 'toas')

    this._onToggle = onToggle
    this._onClearHistory = onClearHistory
    this._onOpenPreferences = onOpenPreferences
    this._onListHistory = onListHistory
    this._onCopySession = onCopySession
    this._onRetrySession = onRetrySession
    this._onCanRetrySession = onCanRetrySession
    this._onPrivateModeChanged = onPrivateModeChanged

    // PanelMenu's built-in gesture opens the menu for every click. Route
    // mouse buttons explicitly so the primary action stays one click away.
    this._clickGesture?.set_enabled(false)

    this._icon = new St.Icon({
      icon_name: 'audio-input-microphone-symbolic',
      style_class: 'system-status-icon toas-status-icon'
    })
    this.add_child(this._icon)

    const historyHeading = new PopupMenu.PopupMenuItem('Your words', {
      reactive: false
    })
    addMenuIcon(historyHeading, 'document-open-recent-symbolic')
    this.menu.addMenuItem(historyHeading)

    this._historySection = new PopupMenu.PopupMenuSection()
    const scrollSection = new PopupMenu.PopupMenuSection()
    const scrollView = new St.ScrollView({
      style_class: 'toas-history-menu-scroll',
      overlay_scrollbars: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC
    })
    scrollView.add_child(this._historySection.actor)
    scrollSection.actor.add_child(scrollView)
    this.menu.addMenuItem(scrollSection)

    // Session-level switch: private voice inputs leave no local history and
    // their recordings are deleted once processed.
    this._privateModeItem = new PopupMenu.PopupSwitchMenuItem(
      'Private mode',
      false,
      { reactive: true }
    )
    this._privateModeItem.connect('toggled', (_item, enabled) => {
      this._onPrivateModeChanged?.(enabled)
    })
    addMenuIcon(this._privateModeItem, 'security-medium-symbolic')
    this.menu.addMenuItem(this._privateModeItem)

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

    this.menu.connect('open-state-changed', (_menu, open) => {
      if (open) { this._refreshHistory() }
    })

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

    this._icon.icon_name = recording
      ? 'media-record-symbolic'
      : 'audio-input-microphone-symbolic'

    if (recording) {
      this.add_style_class_name('toas-recording')
    } else {
      this.remove_style_class_name('toas-recording')
    }

    // Accessibility: make the state legible without vision.
    this._icon.set_accessible_name?.(this._accessibleIconName(recording))

    this._clearHistoryItem.setSensitive(state === 'idle' || state === 'error')
  }

  setPrivateMode (enabled) {
    if (enabled) {
      this.add_style_class_name('toas-private')
    } else {
      this.remove_style_class_name('toas-private')
    }
  }

  _accessibleIconName (recording) {
    if (recording) { return this._privateModeItem.state ? 'Recording private voice input' : 'Recording voice input' }
    return this._privateModeItem.state ? 'Voice input, private mode on' : 'Voice input'
  }

  _refreshHistory () {
    this._historySection.removeAll()
    const entries = this._onListHistory?.() ?? []

    if (entries.length === 0) {
      this._historySection.addMenuItem(new PopupMenu.PopupMenuItem(
        'Nothing here yet. Say something.',
        { reactive: false }
      ))
      return
    }

    for (const entry of entries) {
      const item = new PopupMenu.PopupBaseMenuItem({ reactive: false })
      const textColumn = new St.BoxLayout({ vertical: true, x_expand: true })
      const preview = new St.Label({
        text: previewText(entry),
        style_class: 'toas-history-preview',
        x_expand: true
      })
      preview.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END)
      preview.get_clutter_text().set_single_line_mode(true)
      const meta = new St.Label({
        text: `${formatRelativeTime(entry.createdAt)} · ${formatDuration(entry.durationMs)}`,
        style_class: 'toas-history-meta'
      })
      textColumn.add_child(preview)
      textColumn.add_child(meta)
      item.add_child(textColumn)

      if (entry.status === 'error' && this._onCanRetrySession?.(entry)) {
        item.add_child(historyActionButton(
          'view-refresh-symbolic',
          'Try again',
          () => this._onRetrySession?.(entry)
        ))
      }

      item.add_child(historyActionButton(
        'edit-copy-symbolic',
        'Copy text',
        () => this._onCopySession?.(entry)
      ))

      this._historySection.addMenuItem(item)
    }
  }

  destroy () {
    this._onToggle = null
    this._onClearHistory = null
    this._onOpenPreferences = null
    this._onListHistory = null
    this._onCopySession = null
    this._onRetrySession = null
    this._onCanRetrySession = null
    this._onPrivateModeChanged = null
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

function historyActionButton (iconName, accessibleName, onClicked) {
  const button = new St.Button({
    style_class: 'icon-button toas-history-action',
    accessible_name: accessibleName,
    can_focus: true,
    child: new St.Icon({
      icon_name: iconName,
      style_class: 'toas-history-action-icon'
    })
  })
  button.connect('clicked', onClicked)
  return button
}
