import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

export default class ToasPreferences extends ExtensionPreferences {
  fillPreferencesWindow (window) {
    const settings = this.getSettings()

    const page = new Adw.PreferencesPage({
      title: 'toas',
      icon_name: 'audio-input-microphone-symbolic'
    })

    const inputGroup = new Adw.PreferencesGroup({
      title: 'Push-to-Talk',
      description: 'Hold the shortcut, speak, then release the modifiers to finish.'
    })

    const shortcut = new Adw.EntryRow({
      title: 'Shortcut',
      text: settings.get_strv('push-to-talk')[0] ?? ''
    })
    const shortcutLabel = new Gtk.ShortcutLabel({
      accelerator: shortcut.text,
      valign: Gtk.Align.CENTER
    })
    shortcut.add_suffix(shortcutLabel)
    shortcut.connect('changed', () => {
      const value = shortcut.text.trim()
      settings.set_strv('push-to-talk', value ? [value] : [])
      shortcutLabel.accelerator = value
    })

    const restoreClipboard = new Adw.SwitchRow({
      title: 'Restore text clipboard',
      subtitle: 'Restore the previous clipboard text after auto-paste.'
    })
    settings.bind(
      'restore-clipboard',
      restoreClipboard,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    )

    inputGroup.add(shortcut)
    inputGroup.add(restoreClipboard)

    const historyGroup = new Adw.PreferencesGroup({
      title: 'History',
      description: 'Sessions are stored under XDG_STATE_HOME/toas. Old text and recordings are removed together.'
    })
    const historyLimit = new Adw.SpinRow({
      title: 'Sessions to keep',
      subtitle: 'Includes the transcript, refined output, timing, and WAV recording.',
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 1000,
        step_increment: 1,
        page_increment: 10,
        value: settings.get_uint('history-limit')
      }),
      digits: 0,
      numeric: true
    })
    historyLimit.connect('notify::value', () => {
      settings.set_uint('history-limit', Math.round(historyLimit.value))
    })
    historyGroup.add(historyLimit)

    const transcriptionGroup = new Adw.PreferencesGroup({
      title: 'Transcription',
      description: 'Sends WAV as a Data URL through one non-streaming JSON multimodal Chat Completions request.'
    })
    transcriptionGroup.add(entry(
      settings,
      'transcription-endpoint',
      'Chat completions endpoint'
    ))
    transcriptionGroup.add(entry(settings, 'transcription-model', 'Model'))
    transcriptionGroup.add(entry(
      settings,
      'transcription-language',
      'Language',
      'Optional ISO-639-1 code, for example en or zh. Leave empty for automatic detection.'
    ))
    transcriptionGroup.add(passwordEntry(
      settings,
      'transcription-api-key',
      'API key',
      'Fallback: TOAS_TRANSCRIPTION_API_KEY.'
    ))

    const refineGroup = new Adw.PreferencesGroup({
      title: 'Refine',
      description: 'Uses OpenAI-compatible Chat Completions. Failure falls back to the raw transcript.'
    })

    const refineEnabled = new Adw.SwitchRow({
      title: 'Enable Refine',
      subtitle: 'Disable for literal dictation.'
    })
    settings.bind(
      'refine-enabled',
      refineEnabled,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    )

    refineGroup.add(refineEnabled)
    refineGroup.add(entry(
      settings,
      'refine-endpoint',
      'Chat completions endpoint',
      'Example: https://example.com/v1/chat/completions'
    ))
    refineGroup.add(entry(settings, 'refine-model', 'Model'))
    refineGroup.add(passwordEntry(
      settings,
      'refine-api-key',
      'API key',
      'Fallback: TOAS_REFINE_API_KEY, then OPENAI_API_KEY.'
    ))
    const refinePromptGroup = new Adw.PreferencesGroup({
      title: 'Refine Instructions',
      description: 'Tell the model how to edit the transcript. Formatting such as paragraphs, lists, and code is preserved when pasted.'
    })
    refinePromptGroup.add(textArea(
      settings,
      'refine-system-prompt'
    ))

    const securityGroup = new Adw.PreferencesGroup({
      title: 'Security',
      description: 'Keys entered here are stored in dconf as plain text. For a cleaner setup, leave key fields empty and provide environment variables before logging into GNOME.'
    })

    page.add(inputGroup)
    page.add(historyGroup)
    page.add(transcriptionGroup)
    page.add(refineGroup)
    page.add(refinePromptGroup)
    page.add(securityGroup)
    window.add(page)
  }
}

function textArea (settings, key) {
  const row = new Adw.PreferencesRow()
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    margin_top: 6,
    margin_bottom: 6,
    margin_start: 12,
    margin_end: 12
  })
  const textView = new Gtk.TextView({
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    top_margin: 8,
    bottom_margin: 8,
    left_margin: 8,
    right_margin: 8
  })
  const buffer = textView.get_buffer()
  buffer.text = settings.get_string(key)
  buffer.connect('changed', () => {
    settings.set_string(key, buffer.text)
  })

  const scroller = new Gtk.ScrolledWindow({
    min_content_height: 220,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    has_frame: true,
    child: textView
  })
  box.append(scroller)
  row.set_child(box)
  return row
}

function entry (settings, key, title, tooltip = '') {
  const row = new Adw.EntryRow({
    title,
    text: settings.get_string(key)
  })

  if (tooltip) { row.set_tooltip_text(tooltip) }

  row.connect('changed', () => {
    settings.set_string(key, row.text)
  })

  return row
}

function passwordEntry (settings, key, title, tooltip = '') {
  const row = new Adw.PasswordEntryRow({
    title,
    text: settings.get_string(key)
  })

  if (tooltip) { row.set_tooltip_text(tooltip) }

  row.connect('changed', () => {
    settings.set_string(key, row.text)
  })

  return row
}
