import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { providers as providerRegistry } from './lib/kernel/providers/registry.js'
import { process as kernelProcess, processingError, secretKey } from './lib/kernel/process.js'
import { ConfigService } from './lib/host/config-service.js'
import { SoupHttpTransport } from './lib/host/soup-http-transport.js'
// Numeric values of the schema enums in declaration order; get_enum returns
// numbers, not nicks. Kept next to the schema they mirror.
const PRIMARY_PROVIDER_VALUES = ['qwen', 'mimo']
const REFINE_PROVIDER_VALUES = ['mimo', 'openai', 'openai-compatible']
const REFINE_ON_ERROR_VALUES = ['fallback', 'abort']

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
      description: 'Hold the shortcut, speak, then release.'
    })

    const shortcutRow = new Adw.ActionRow({
      title: 'Shortcut',
      subtitle: 'Click, then press combination. Escape cancels; Backspace clears.'
    })
    shortcutRow.add_suffix(buildShortcutButton(settings))

    const autoPaste = new Adw.SwitchRow({
      title: 'Paste automatically',
      subtitle: 'Paste the result into the focused application. Off copies it to the clipboard only.',
      active: settings.get_boolean('auto-paste')
    })
    autoPaste.connect('notify::active', () => {
      settings.set_boolean('auto-paste', autoPaste.active)
    })

    const restoreClipboard = new Adw.SwitchRow({
      title: 'Restore text clipboard',
      subtitle: 'Restore the previous clipboard text after auto-paste.',
      active: settings.get_boolean('restore-clipboard')
    })
    restoreClipboard.connect('notify::active', () => {
      settings.set_boolean('restore-clipboard', restoreClipboard.active)
    })

    inputGroup.add(shortcutRow)
    inputGroup.add(autoPaste)
    inputGroup.add(restoreClipboard)

    const processingGroup = new Adw.PreferencesGroup({
      title: 'Voice Processing',
      description: 'Your recording is sent to this service to be turned into text.'
    })

    // Primary provider + model + credential, driven by the provider manifests.
    const primaryProviderId = PRIMARY_PROVIDER_VALUES[settings.get_enum('primary-provider')] ?? 'qwen'
    const primaryProvider = providerRegistry.get(primaryProviderId)
    const primaryModelDefault = primaryProvider?.manifest?.processing?.fields
      ?.find(f => f.key === 'model')?.default ?? 'qwen3-asr-flash'

    const providerRow = new Adw.ComboRow({
      title: 'Primary provider',
      subtitle: 'Processes your recording into text',
      model: Gtk.StringList.new(PRIMARY_PROVIDER_VALUES.map(id =>
        providerRegistry.get(id)?.manifest?.label ?? id
      )),
      selected: Math.max(0, PRIMARY_PROVIDER_VALUES.indexOf(primaryProviderId))
    })

    const modelEntry = new Adw.EntryRow({
      title: 'Model',
      text: settings.get_string('primary-model') || primaryModelDefault
    })
    modelEntry.connect('changed', () => {
      settings.set_string('primary-model', modelEntry.get_text())
    })

    const primarySecretRow = secretRow({
      settings,
      providerId: primaryProviderId,
      fieldKey: 'key',
      title: 'API key',
      subtitle: 'Stored in plain text by dconf, or read from the provider environment variables.'
    })

    const primaryTestRow = buildConnectionRow({
      settings,
      role: 'processing',
      label: 'Test connection',
      description: 'Sends a short silent sample through the same processing path as a real voice input.'
    })

    providerRow.connect('notify::selected', () => {
      const nextId = PRIMARY_PROVIDER_VALUES[providerRow.selected] ?? 'qwen'
      settings.set_enum('primary-provider', PRIMARY_PROVIDER_VALUES.indexOf(nextId))

      const nextProvider = providerRegistry.get(nextId)
      const nextModel = nextProvider?.manifest?.processing?.fields
        ?.find(f => f.key === 'model')?.default ?? ''
      settings.set_string('primary-model', nextModel)
      modelEntry.set_text(nextModel)

      primarySecretRow.rebind(nextId)
      primaryTestRow.rebind()
    })

    processingGroup.add(providerRow)
    processingGroup.add(modelEntry)
    processingGroup.add(primarySecretRow.row)
    processingGroup.add(primaryTestRow.row)

    // Custom Terms: Host-owned Context source, not provider configuration.
    const termsGroup = new Adw.PreferencesGroup({
      title: 'Custom Terms',
      description: 'Terms you list here are sent as recognition context to providers that support it. toas never reads your desktop, editor, clipboard, or files on its own.'
    })

    const termsBuffer = new Gtk.TextBuffer()
    termsBuffer.set_text(settings.get_strv('custom-terms').join('\n'), -1)
    const termsView = new Gtk.TextView({
      buffer: termsBuffer,
      wrap_mode: Gtk.WrapMode.WORD,
      top_margin: 12,
      bottom_margin: 12,
      left_margin: 12,
      right_margin: 12,
      hexpand: true
    })
    termsView.add_css_class('inline')
    termsBuffer.connect('changed', () => {
      const [start, end] = termsBuffer.get_bounds()
      const text = termsBuffer.get_text(start, end, false)
      settings.set_strv('custom-terms', text.split('\n').map(t => t.trim()).filter(Boolean))
    })
    termsGroup.add(termsView)

    // Optional Refine: an enhancement of voice processing, not a product of
    // its own.
    const refineGroup = new Adw.PreferencesGroup({
      title: 'Refine (optional)',
      description: 'Applies your instructions to the primary text with a second service.'
    })

    const refineEnabled = new Adw.SwitchRow({
      title: 'Enable Refine',
      subtitle: 'Disable for literal dictation.',
      active: settings.get_boolean('refine-enabled')
    })

    const refineWarning = new Adw.ActionRow({ title: 'Refine is not active' })
    refineWarning.add_css_class('warning')

    const refineProviderRow = new Adw.ComboRow({
      title: 'Refine provider',
      subtitle: 'Processes the primary text',
      model: Gtk.StringList.new(REFINE_PROVIDER_VALUES.map(id =>
        providerRegistry.get(id)?.manifest?.label ?? id
      )),
      selected: Math.max(0, REFINE_PROVIDER_VALUES.indexOf(
        REFINE_PROVIDER_VALUES[settings.get_enum('refine-provider')] ?? 'mimo'
      ))
    })

    const refineModelEntry = new Adw.EntryRow({
      title: 'Refine model',
      text: settings.get_string('refine-model') || ''
    })
    refineModelEntry.connect('changed', () => {
      settings.set_string('refine-model', refineModelEntry.get_text())
    })

    const refineSecretRow = secretRow({
      settings,
      providerId: REFINE_PROVIDER_VALUES[settings.get_enum('refine-provider')] ?? 'mimo',
      fieldKey: 'key',
      title: 'Refine API key',
      subtitle: 'Shared with the same provider when both roles use it.'
    })

    const refineOnErrorRow = new Adw.ComboRow({
      title: 'Failure behavior',
      subtitle: 'What happens when refine fails after primary processing succeeds.',
      model: Gtk.StringList.new(['Insert primary text', 'Fail the voice input']),
      selected: Math.max(0, REFINE_ON_ERROR_VALUES.indexOf(
        REFINE_ON_ERROR_VALUES[settings.get_enum('refine-on-error')] ?? 'fallback'
      ))
    })

    const refineTestRow = buildConnectionRow({
      settings,
      role: 'refine',
      label: 'Test connection',
      description: 'Sends a short fixed text through the same refine path as a real voice input.'
    })

    const instructionsGroup = new Adw.PreferencesGroup({
      title: 'Refine Instructions',
      description: 'Tell the refine provider how to edit the primary text. Paragraphs, lists, and code formatting are kept when pasted.'
    })
    const instructionsBuffer = new Gtk.TextBuffer()
    const instructionsView = new Gtk.TextView({
      buffer: instructionsBuffer,
      wrap_mode: Gtk.WrapMode.WORD_CHAR,
      top_margin: 12,
      bottom_margin: 12,
      left_margin: 18,
      right_margin: 18,
      hexpand: true,
      vexpand: true
    })
    instructionsView.add_css_class('inline')
    const instructionsScroller = new Gtk.ScrolledWindow({
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      min_content_height: 180,
      max_content_height: 220,
      child: instructionsView
    })
    instructionsScroller.add_css_class('card')

    const refineRows = [
      refineProviderRow,
      refineModelEntry,
      refineSecretRow.row,
      refineOnErrorRow,
      refineTestRow.row
    ]

    const applyRefineState = () => {
      const enabled = refineEnabled.active
      refineRows.forEach(row => { row.visible = enabled })
      instructionsGroup.visible = enabled

      const refineProviderId = REFINE_PROVIDER_VALUES[refineProviderRow.selected] ?? 'mimo'
      const model = refineModelEntry.get_text().trim()
      const missing = []
      if (!model) { missing.push('a refine model') }
      if (!refineSecretRow.hasValue()) { missing.push('a refine API key') }

      if (enabled && missing.length > 0) {
        refineWarning.visible = true
        refineWarning.subtitle =
          `Missing ${missing.join(' and ')}. Until then, voice inputs keep the primary text without refining.`
      } else {
        refineWarning.visible = false
      }
    }

    refineProviderRow.connect('notify::selected', () => {
      const nextId = REFINE_PROVIDER_VALUES[refineProviderRow.selected] ?? 'mimo'
      settings.set_enum('refine-provider', REFINE_PROVIDER_VALUES.indexOf(nextId))
      refineSecretRow.rebind(nextId)
      refineTestRow.rebind()
      applyRefineState()
    })
    refineOnErrorRow.connect('notify::selected', () => {
      const value = REFINE_ON_ERROR_VALUES[refineOnErrorRow.selected] ?? 'fallback'
      settings.set_enum('refine-on-error', REFINE_ON_ERROR_VALUES.indexOf(value))
    })
    refineEnabled.connect('notify::active', () => {
      settings.set_boolean('refine-enabled', refineEnabled.active)
      applyRefineState()
    })
    refineModelEntry.connect('changed', applyRefineState)
    primarySecretRow.onChange(applyRefineState)
    refineSecretRow.onChange(applyRefineState)

    // The schema default is the single source of the template; anything the
    // user saved replaces it. The initial fill runs after the changed handler
    // so the template is persisted on first open instead of staying a UI-only
    // default that the processing path would read as empty.
    const defaultInstructions = settings.get_default_value('refine-instructions')?.unpack?.() ?? ''
    instructionsBuffer.connect('changed', () => {
      const [start, end] = instructionsBuffer.get_bounds()
      settings.set_string('refine-instructions', instructionsBuffer.get_text(start, end, false))
    })
    instructionsBuffer.set_text(settings.get_string('refine-instructions') || defaultInstructions, -1)

    refineGroup.add(refineEnabled)
    refineGroup.add(refineWarning)
    refineRows.forEach(row => refineGroup.add(row))

    const securityGroup = new Adw.PreferencesGroup({
      title: 'Security',
      description: 'Keys entered here are stored in plain text by your system settings. To keep keys out of that storage, leave the fields empty and set the provider environment variables before logging in.'
    })

    const recordingGroup = new Adw.PreferencesGroup({
      title: 'Recording',
      description: 'Capture format for new recordings. Existing history keeps its format.'
    })

    const qualityModel = Gtk.StringList.new([
      'Standard · 16 kHz',
      'High · 48 kHz',
      'Balanced · 24 kHz'
    ])
    const qualityValues = [0, 1, 2]
    const qualitySelector = new Gtk.DropDown({
      model: qualityModel,
      valign: Gtk.Align.CENTER,
      width_request: 190
    })
    qualitySelector.selected = Math.max(0, qualityValues.indexOf(settings.get_enum('audio-quality')))
    const qualityRow = new Adw.ActionRow({
      title: 'Audio quality',
      subtitle: 'Standard: ~13 min cap · Balanced: ~9 min · High: ~4 min.'
    })
    qualityRow.add_suffix(qualitySelector)
    qualitySelector.connect('notify::selected', () => {
      settings.set_enum('audio-quality', qualityValues[qualitySelector.selected] ?? 0)
    })
    recordingGroup.add(qualityRow)

    const historyGroup = new Adw.PreferencesGroup({
      title: 'History',
      description: 'Your words and some recordings are kept on this device. Manage them from the top-bar menu.'
    })
    historyGroup.add(spinRow(settings, 'history-limit', 'History items to keep', 'Keeps this many recent items.', 1, 1000))
    historyGroup.add(spinRow(settings, 'recording-limit', 'Recordings to keep', 'Keeps the audio file for this many recent items.', 1, 1000))

    page.add(inputGroup)
    page.add(processingGroup)
    page.add(termsGroup)
    page.add(refineGroup)
    page.add(instructionsGroup)
    page.add(securityGroup)
    page.add(recordingGroup)
    page.add(historyGroup)
    window.add(page)

    applyRefineState()
  }
}

function spinRow (settings, key, title, subtitle, lower, upper) {
  const row = new Adw.SpinRow({
    title,
    subtitle,
    adjustment: new Gtk.Adjustment({
      lower,
      upper,
      step_increment: 1,
      page_increment: 10,
      value: settings.get_uint(key)
    }),
    digits: 0,
    numeric: true
  })
  row.connect('notify::value', () => {
    settings.set_uint(key, Math.round(row.value))
  })
  return row
}

// Secret rows write only the provider secret map; the value never touches any
// other setting. An empty entry removes the stored value so the environment
// fallback applies again. Environment values are never loaded into a widget.
function secretRow ({ settings, providerId, fieldKey, title, subtitle }) {
  const entry = new Adw.PasswordEntryRow({ title })
  if (subtitle) { entry.set_tooltip_text(subtitle) }

  const readStored = () => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    return map[secretKey(providerId, fieldKey)] ?? ''
  }

  const writeStored = value => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    const key = secretKey(providerId, fieldKey)
    if (value) { map[key] = value } else { delete map[key] }
    const variant = new GLib.Variant('a{ss}', map)
    settings.set_value('provider-secrets', variant)
    changeHandlers.forEach(handler => handler())
  }

  const changeHandlers = []

  entry.connect('changed', () => {
    writeStored(entry.get_text().trim())
  })

  const rebind = nextProviderId => {
    providerId = nextProviderId
    entry.text = readStored()
  }

  rebind(providerId)

  return {
    row: entry,
    rebind,
    hasValue: () => Boolean(readStored() || envFallbackPresent(providerId, fieldKey)),
    onChange: handler => changeHandlers.push(handler)
  }
}

function envFallbackPresent (providerId, fieldKey) {
  const provider = providerRegistry.get(providerId)
  const field = (provider?.manifest?.fields ?? []).find(f => f.key === fieldKey)
  return (field?.env ?? []).some(name => Boolean(GLib.getenv(name)?.trim()))
}

// Connection test: resolves the current settings into the same Config shape
// production uses, then runs the real Provider Processor through the real
// Kernel and a short-timeout Soup transport. No probe endpoint, no duplicated
// payload code, and no history/output side effects.
function buildConnectionRow ({ settings, role, label, description }) {
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER, label })
  const row = new Adw.ActionRow({ title: 'Connection', subtitle: description })
  row.add_suffix(button)

  let busy = false

  const setStatus = text => { row.subtitle = text || description }

  button.connect('clicked', async () => {
    if (busy) { return }
    busy = true
    button.sensitive = false
    setStatus('Testing…')

    try {
      await runConnectionTest({ settings, role })
      setStatus('✓ Connection works')
    } catch (error) {
      setStatus(`✗ ${error.message ?? 'Could not reach the service'}`)
    } finally {
      busy = false
      button.sensitive = true
    }
  })

  return { row, rebind: () => setStatus(description) }
}

// Connection test: resolves the current settings into the same Config shape
// production uses, then runs the real Provider Processor through the real
// Kernel and a short-timeout Soup transport. No probe endpoint, no duplicated
// payload code, and no history/output side effects.
async function runConnectionTest ({ settings, role }) {
  const configService = new ConfigService({ settings, providers: providerRegistry })
  const config = configService.snapshotConfig()
  const secrets = configService.snapshotSecrets()

  if (role === 'refine' && !config.refine.enabled) {
    throw processingError('configuration', 'Enable Refine first.')
  }

  // Both roles go through the same Kernel path with a harmless input: a
  // silent WAV exercises the real audio request shape; fixed text exercises
  // the real refine request shape.
  const audio = role === 'processing'
    ? { kind: 'audio', base64: silenceWavBase64(16000), mimeType: 'audio/wav', durationMs: 250 }
    : { kind: 'text', text: 'Reply with OK.' }

  const transport = new SoupHttpTransport({ timeoutMs: 20000 })
  try {
    await kernelProcess({
      config,
      audio,
      context: { terms: [], passages: [] },
      secrets,
      runtime: { transport, clock: { now: () => 0 } },
      signal: null
    })
  } catch (error) {
    // A valid round trip with no speech means the endpoint answered with the
    // expected response shape: connectivity success.
    if (error.category === 'no-text') { return }
    throw error
  } finally {
    transport.destroy()
  }
}

// 0.25 s of silence, 16 kHz mono 16-bit, wrapped in a minimal WAV header.
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
