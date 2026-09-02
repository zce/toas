import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'
import Soup from 'gi://Soup?version=3.0'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'
import { resolveRefineConfig, resolveSampleRate, resolveTranscriptionConfig } from './lib/effective-config.js'

// Inline shortcut capture, modeled on Clipboard Indicator: a frameless button
// enters capture mode via Gtk.EventControllerKey; Escape cancels, Backspace
// disables, any other combination is normalized and saved.
function buildShortcutButton (settings) {
  const button = new Gtk.Button({ has_frame: false })

  const setLabelFromSettings = () => {
    const value = settings.get_strv('push-to-talk')[0]
    button.set_label(value || 'Disabled')
  }

  let editing = false
  let controller = null
  let debounceId = 0

  const stopEditing = () => {
    editing = false
    if (controller) {
      button.remove_controller(controller)
      controller = null
    }
    if (debounceId) {
      GLib.source_remove(debounceId)
      debounceId = 0
    }
    setLabelFromSettings()
  }

  button.connect('clicked', () => {
    if (editing) {
      stopEditing()
      return
    }

    editing = true
    button.set_label('Press a key combination…')

    controller = new Gtk.EventControllerKey()
    button.add_controller(controller)

    controller.connect('key-pressed', (_ec, keyval, keycode, mask) => {
      if (debounceId) {
        GLib.source_remove(debounceId)
        debounceId = 0
      }

      mask &= Gtk.accelerator_get_default_mod_mask()

      if (mask === 0) {
        if (keyval === Gdk.KEY_Escape) {
          stopEditing()
          return Gdk.EVENT_STOP
        }
        if (keyval === Gdk.KEY_BackSpace) {
          settings.set_strv('push-to-talk', [])
          stopEditing()
          return Gdk.EVENT_STOP
        }
      }

      // Bare modifier presses are not valid accelerators.
      const bareModifiers = [
        Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
        Gdk.KEY_Control_L, Gdk.KEY_Control_R,
        Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
        Gdk.KEY_Super_L, Gdk.KEY_Super_R,
        Gdk.KEY_Meta_L, Gdk.KEY_Meta_R
      ]
      if (bareModifiers.includes(keyval)) {
        button.set_label('Add a regular key to the modifier…')
        return Gdk.EVENT_STOP
      }

      const accelerator = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask)
      if (!accelerator || !Gtk.accelerator_valid(keyval, mask)) {
        button.set_label('That combination cannot be used…')
        return Gdk.EVENT_STOP
      }
      button.set_label(accelerator)

      // Small debounce so modifier taps settle before saving.
      debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        debounceId = 0
        settings.set_strv('push-to-talk', [accelerator])
        stopEditing()
        return GLib.SOURCE_REMOVE
      })

      return Gdk.EVENT_STOP
    })
  })

  setLabelFromSettings()
  return button
}

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

    const shortcutRow = new Adw.ActionRow({
      title: 'Shortcut',
      subtitle: 'Click the button, then press the combination. Escape cancels; Backspace clears.'
    })
    shortcutRow.add_suffix(buildShortcutButton(settings))

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

    const autoPaste = new Adw.SwitchRow({
      title: 'Paste automatically',
      subtitle: 'Paste the result into the focused application. Off copies it to the clipboard only, so you paste it yourself.'
    })
    settings.bind(
      'auto-paste',
      autoPaste,
      'active',
      Gio.SettingsBindFlags.DEFAULT
    )

    inputGroup.add(shortcutRow)
    inputGroup.add(autoPaste)
    inputGroup.add(restoreClipboard)

    const recordingGroup = new Adw.PreferencesGroup({
      title: 'Recording',
      description: 'Capture format for new recordings. Existing history keeps its format.'
    })

    const qualityModel = Gtk.StringList.new([
      'Standard · 16 kHz',
      'Balanced · 24 kHz',
      'High · 48 kHz'
    ])
    const qualityValues = [0, 2, 1]
    const qualitySelector = new Gtk.DropDown({
      model: qualityModel,
      valign: Gtk.Align.CENTER,
      width_request: 190
    })
    qualitySelector.selected = Math.max(
      0,
      qualityValues.indexOf(settings.get_enum('audio-quality'))
    )

    const qualityRow = new Adw.ActionRow({
      title: 'Audio quality',
      subtitle: 'Standard: ~13 min cap · Balanced: ~9 min · High: ~4 min.'
    })
    qualityRow.add_suffix(qualitySelector)
    qualitySelector.connect('notify::selected', () => {
      settings.set_enum(
        'audio-quality',
        qualityValues[qualitySelector.selected] ?? 0
      )
    })

    recordingGroup.add(qualityRow)

    const historyGroup = new Adw.PreferencesGroup({
      title: 'History',
      description: 'Your words and some recordings are kept on this device. Manage them from the top-bar menu.'
    })
    const historyLimit = new Adw.SpinRow({
      title: 'History items to keep',
      subtitle: 'Keeps this many recent items.',
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
    const recordingsLimit = new Adw.SpinRow({
      title: 'Recordings to keep',
      subtitle: 'Keeps the audio file for this many recent items. Older items keep their text but lose the recording.',
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 1000,
        step_increment: 1,
        page_increment: 10,
        value: settings.get_uint('recording-limit')
      }),
      digits: 0,
      numeric: true
    })
    recordingsLimit.connect('notify::value', () => {
      settings.set_uint(
        'recording-limit',
        Math.round(recordingsLimit.value)
      )
    })
    historyGroup.add(historyLimit)
    historyGroup.add(recordingsLimit)

    const transcriptionGroup = new Adw.PreferencesGroup({
      title: 'Transcription',
      description: 'Your recording is sent to this service to be turned into text.'
    })
    transcriptionGroup.add(entry(
      settings,
      'transcription-endpoint',
      'Service endpoint'
    ))
    transcriptionGroup.add(entry(settings, 'transcription-model', 'Model'))
    transcriptionGroup.add(entry(
      settings,
      'transcription-language',
      'Language',
      'Optional language code, for example en or zh. Leave empty for automatic detection.'
    ))
    transcriptionGroup.add(passwordEntry(
      settings,
      'transcription-api-key',
      'API key',
      'Also read from TOAS_TRANSCRIPTION_API_KEY when left empty.'
    ))

    const testRow = buildTestConnectionRow(settings)
    transcriptionGroup.add(testRow.row)

    const refineGroup = new Adw.PreferencesGroup({
      title: 'Refine',
      description: 'Cleans up the raw transcript before it is inserted. If it fails, the raw transcript is used.'
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

    const refineWarning = new Adw.ActionRow({ title: 'Refine is not active' })
    refineWarning.add_css_class('warning')
    refineGroup.add(refineWarning)

    refineGroup.add(refineEnabled)
    refineGroup.add(entry(
      settings,
      'refine-endpoint',
      'Service endpoint',
      'Example: https://example.com/v1/chat/completions'
    ))
    refineGroup.add(entry(settings, 'refine-model', 'Model'))
    refineGroup.add(passwordEntry(
      settings,
      'refine-api-key',
      'API key',
      'Also read from TOAS_REFINE_API_KEY, then OPENAI_API_KEY, when left empty.'
    ))
    refineGroup.add(buildRefineTestConnectionRow(settings).row)
    const refinePromptGroup = new Adw.PreferencesGroup({
      title: 'Refine Instructions',
      description: 'Tell the model how to edit your transcript. Paragraphs, lists, and code formatting are kept when pasted.'
    })
    refinePromptGroup.add(textArea(
      settings,
      'refine-system-prompt'
    ))

    const securityGroup = new Adw.PreferencesGroup({
      title: 'Security',
      description: 'Keys entered here are stored in plain text by your system settings. To keep keys out of that storage, leave the fields empty and set the environment variables before logging in.'
    })

    const updateRefineWarning = () => {
      const refine = resolveRefineConfig(settings)
      const missing = []
      if (!refine.model.value) { missing.push('a model') }
      if (!refine.apiKey.present) { missing.push('an API key') }

      if (refine.enabled && missing.length > 0) {
        refineWarning.visible = true
        refineWarning.subtitle =
                `Missing ${missing.join(' and ')}. Until then recordings keep the ` +
                'raw transcript without polishing.'
      } else {
        refineWarning.visible = false
      }
    }

    const settingsChangedId = settings.connect('changed', updateRefineWarning)
    refineEnabled.connect('notify::active', updateRefineWarning)
    updateRefineWarning()
    window.connect('destroy', () => {
      settings.disconnect(settingsChangedId)
    })

    page.add(inputGroup)
    page.add(recordingGroup)
    page.add(historyGroup)
    page.add(transcriptionGroup)
    page.add(refineGroup)
    page.add(refinePromptGroup)
    page.add(securityGroup)
    window.add(page)
  }
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

// "Test connection" row: sends one tiny generated-WAV request through the same
// effective configuration as production and reports the outcome inline.
Gio._promisify(
  Soup.Session.prototype,
  'send_and_read_async',
  'send_and_read_finish'
)

function buildTestConnectionRow (settings) {
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER })
  button.set_label('Test connection')

  const description = 'Sends a short silent sample to check endpoint, key, and model.'
  const row = new Adw.ActionRow({
    title: 'Connection',
    subtitle: description
  })
  row.add_suffix(button)

  let busy = false

  const setStatus = text => {
    row.subtitle = text || description
  }

  button.connect('clicked', async () => {
    if (busy) { return }

    const config = resolveTranscriptionConfig(settings)
    if (!config.ready) {
      setStatus('Add an API key first.')
      return
    }

    busy = true
    button.set_sensitive(false)
    setStatus('Testing…')

    try {
      await probeTranscriptionEndpoint(config, settings)
      setStatus('✓ Connection works')
    } catch (error) {
      setStatus(`✗ ${describeProbeFailure(error)}`)
    } finally {
      busy = false
      button.set_sensitive(true)
    }
  })

  return { row, button }
}

function buildRefineTestConnectionRow (settings) {
  const button = new Gtk.Button({
    label: 'Test connection',
    valign: Gtk.Align.CENTER
  })
  const description = 'Sends a short text request to check endpoint, key, and model.'
  const row = new Adw.ActionRow({
    title: 'Connection',
    subtitle: description
  })
  row.add_suffix(button)

  let busy = false
  button.connect('clicked', async () => {
    if (busy) { return }

    const config = resolveRefineConfig(settings)
    if (!config.model.value || !config.apiKey.present) {
      row.subtitle = 'Add a model and API key first.'
      return
    }

    busy = true
    button.sensitive = false
    row.subtitle = 'Testing…'
    try {
      await probeRefineEndpoint(config, settings)
      row.subtitle = '✓ Connection works'
    } catch (error) {
      row.subtitle = `✗ ${describeProbeFailure(error)}`
    } finally {
      busy = false
      button.sensitive = true
    }
  })

  return { row, button }
}

// One non-streaming request with a 0.25 s silent WAV payload. Success requires
// the same assistant-message shape the production client consumes.
async function probeTranscriptionEndpoint (config, settings) {
  const message = Soup.Message.new('POST', config.endpoint.value)
  message.get_request_headers().append('Authorization', `Bearer ${readTranscriptionKey(settings)}`)
  message.set_request_body_from_bytes(
    'application/json',
    new GLib.Bytes(new TextEncoder().encode(JSON.stringify({
      model: config.model.value,
      messages: [{
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: { data: `data:audio/wav;base64,${silenceWavBase64(resolveSampleRate(settings))}` }
        }]
      }],
      asr_options: { language: config.language },
      stream: false
    })))
  )

  const session = new Soup.Session()
  session.timeout = 20

  const bytes = await session.send_and_read_async(
    message,
    GLib.PRIORITY_DEFAULT,
    null
  )

  const status = message.get_status()
  if (status < 200 || status >= 300) {
    const body = new TextDecoder().decode(bytes.get_data()).slice(0, 160)
    const error = new Error(`HTTP ${status}`)
    error.httpStatus = status
    error.responseBody = body
    throw error
  }

  validateProbeResponse(message, bytes)
}

async function probeRefineEndpoint (config, settings) {
  const message = Soup.Message.new('POST', config.endpoint.value)
  message.get_request_headers().append(
    'Authorization',
    `Bearer ${readRefineKey(settings)}`
  )
  message.set_request_body_from_bytes(
    'application/json',
    new GLib.Bytes(new TextEncoder().encode(JSON.stringify({
      model: config.model.value,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      stream: false
    })))
  )

  const session = new Soup.Session()
  session.timeout = 20
  const bytes = await session.send_and_read_async(
    message,
    GLib.PRIORITY_DEFAULT,
    null
  )
  validateProbeResponse(message, bytes)
}

function validateProbeResponse (message, bytes) {
  const status = message.get_status()
  if (status < 200 || status >= 300) {
    const error = new Error(`HTTP ${status}`)
    error.httpStatus = status
    error.responseBody = new TextDecoder()
      .decode(bytes.get_data())
      .slice(0, 160)
    throw error
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes.get_data()))
    const content = parsed?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) { throw new Error() }
  } catch {
    const error = new Error('Response was not valid JSON')
    error.invalidJson = true
    throw error
  }
}

function readTranscriptionKey (settings) {
  const userValue = settings.get_user_value('transcription-api-key')
    ? settings.get_string('transcription-api-key').trim()
    : ''
  if (userValue) { return userValue }

  const envValue = GLib.getenv('TOAS_TRANSCRIPTION_API_KEY')
  if (envValue && envValue.trim()) { return envValue.trim() }

  return ''
}

function readRefineKey (settings) {
  const userValue = settings.get_user_value('refine-api-key')
    ? settings.get_string('refine-api-key').trim()
    : ''
  return userValue ||
    GLib.getenv('TOAS_REFINE_API_KEY')?.trim() ||
    GLib.getenv('OPENAI_API_KEY')?.trim() ||
    ''
}

function describeProbeFailure (error) {
  if (error?.httpStatus === 401 || error?.httpStatus === 403) {
    return 'Key rejected — check the API key.'
  }
  if (error?.httpStatus === 404) {
    return 'Endpoint or model not found — check both spellings.'
  }
  if (error?.httpStatus === 429) {
    return 'Rate limited — the key works, but requests are throttled.'
  }
  if (error?.httpStatus) {
    return `HTTP ${error.httpStatus} — the endpoint responded with an error.`
  }
  if (error?.invalidJson) {
    return 'The endpoint did not return Chat Completions JSON.'
  }
  return 'Could not reach the endpoint — check the URL and connection.'
}

// 0.25 s of silence at the currently selected sample rate, mono 16-bit,
// wrapped in a minimal WAV header. The probe uses the same format real
// recordings will be sent in.
function silenceWavBase64 (sampleRate) {
  const durationSeconds = 0.25
  const sampleCount = Math.floor(sampleRate * durationSeconds)
  const dataBytes = sampleCount * 2

  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i++) { view.setUint8(offset + i, text.charCodeAt(i)) }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  const wav = new Uint8Array(44 + dataBytes)
  wav.set(new Uint8Array(header), 0)
  return GLib.base64_encode(wav)
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

function textArea (settings, key) {
  const textView = new Gtk.TextView({
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    top_margin: 12,
    bottom_margin: 12,
    left_margin: 18,
    right_margin: 18,
    hexpand: true,
    vexpand: true
  })

  textView.add_css_class('inline')

  const buffer = textView.get_buffer()
  buffer.text = settings.get_string(key)

  buffer.connect('changed', () => {
    settings.set_string(key, buffer.text)
  })

  const scroller = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    min_content_height: 220,
    max_content_height: 220,
    child: textView
  })

  scroller.add_css_class('card')

  return scroller
}
