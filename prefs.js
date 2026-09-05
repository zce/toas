import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { providers as providerRegistry } from './lib/kernel/providers/registry.js'
import { secretKey } from './lib/kernel/process.js'
import { ConfigService } from './lib/host/config-service.js'
import { runConnectionTest } from './lib/host/connection-check.js'
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

    // Preferences run in their own GTK4 process; the Shell stylesheet is
    // not loaded there, so prefs.css styles this window. Loading in
    // fillPreferencesWindow keeps the provider scoped to this window's
    // lifetime rather than the process.
    loadPrefsCss(this.path)

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
      subtitle: 'Paste the result into the focused application. Off copies it to the clipboard only.'
    })
    settings.bind('auto-paste', autoPaste, 'active', Gio.SettingsBindFlags.DEFAULT)

    const restoreClipboard = new Adw.SwitchRow({
      title: 'Restore text clipboard',
      subtitle: 'Restore the previous clipboard text after auto-paste.'
    })
    settings.bind('restore-clipboard', restoreClipboard, 'active', Gio.SettingsBindFlags.DEFAULT)

    inputGroup.add(shortcutRow)
    inputGroup.add(autoPaste)
    inputGroup.add(restoreClipboard)

    // Voice Processing is the core of the product: the primary audio-to-text
    // provider, with the optional Refine enhancement nested inside it.
    const processingGroup = new Adw.PreferencesGroup({
      title: 'Voice Processing',
      description: 'Your recording is sent to this service to be turned into text.'
    })

    const providerLabel = id => providerRegistry.get(id)?.manifest?.label ?? id
    const primaryCapabilities = id =>
      Boolean(providerRegistry.get(id)?.manifest?.primary?.capabilities?.context)
    const refineCapabilities = id =>
      Boolean(providerRegistry.get(id)?.manifest?.refine?.capabilities?.context)

    // Primary provider + model + credential, driven by the provider manifests.
    const primaryProviderId = PRIMARY_PROVIDER_VALUES[settings.get_enum('primary-provider')] ?? 'qwen'
    const primaryProvider = providerRegistry.get(primaryProviderId)
    const primaryModelDefault = primaryProvider?.manifest?.primary?.fields
      ?.find(f => f.key === 'model')?.default ?? 'fun-asr-flash-2026-06-15'

    const providerRow = new Adw.ComboRow({
      title: 'Primary provider',
      subtitle: 'Processes your recording into text',
      model: Gtk.StringList.new(PRIMARY_PROVIDER_VALUES.map(providerLabel)),
      selected: Math.max(0, PRIMARY_PROVIDER_VALUES.indexOf(primaryProviderId))
    })

    const modelEntry = new Adw.EntryRow({
      title: 'Model',
      text: settings.get_string('primary-model') || primaryModelDefault
    })
    modelEntry.connect('changed', () => {
      settings.set_string('primary-model', modelEntry.get_text())
    })

    // One stored key per provider; the row title shows whose key it is.
    const primarySecretRow = secretRow({
      settings,
      providerId: primaryProviderId,
      fieldKey: 'key',
      title: `${providerLabel(primaryProviderId)} API key`,
      subtitle: 'One key per provider, stored in plain text by dconf, or read from the provider environment variables.'
    })

    const primaryTestRow = buildConnectionRow({
      settings,
      role: 'primary',
      label: 'Test connection',
      description: 'Sends a short silent sample through the same processing path as a real voice input.'
    })

    // --- Refine: an enhancement nested inside voice processing -------------

    const refineProviderRow = new Adw.ComboRow({
      title: 'Refine provider',
      subtitle: 'Processes the primary text',
      model: Gtk.StringList.new(REFINE_PROVIDER_VALUES.map(providerLabel)),
      selected: Math.max(0, REFINE_PROVIDER_VALUES.indexOf(
        REFINE_PROVIDER_VALUES[settings.get_enum('refine-provider')] ?? 'mimo'
      ))
    })

    const refineProviderId = () => REFINE_PROVIDER_VALUES[refineProviderRow.selected] ?? 'mimo'

    const refineModelEntry = new Adw.EntryRow({
      title: 'Refine model',
      text: settings.get_string('refine-model') || ''
    })
    refineModelEntry.connect('changed', () => {
      settings.set_string('refine-model', refineModelEntry.get_text())
    })

    const refineSecretRow = secretRow({
      settings,
      providerId: refineProviderId(),
      fieldKey: 'key',
      title: `${providerLabel(refineProviderId())} API key`,
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

    // The schema default is the single source of the instruction template;
    // anything the user saved replaces it.
    const defaultInstructions = settings.get_default_value('refine-instructions')?.unpack?.() ?? ''

    const refineWarning = new Adw.Banner({ title: '' })

    // Refine Instructions: a PreferencesRow whose whole surface is the
    // input, EntryRow's design language at multiline scale. The persistent
    // compact title keeps the field identifiable once text fills the row.
    const instructionsRow = textAreaRow(settings, 'refine-instructions', 'Refine instructions', {
      defaultText: defaultInstructions,
      minHeight: 84,
      maxHeight: 200
    })

    // The enable switch carries refine-enabled directly; while off, the
    // nested settings stay collapsed and inaccessible.
    const refineExpander = new Adw.ExpanderRow({
      title: 'Refine',
      subtitle: 'Applies your instructions to the primary text with a second service. Disable for literal dictation.',
      show_enable_switch: true,
      enable_expansion: settings.get_boolean('refine-enabled')
    })

    refineExpander.add_row(refineProviderRow)
    refineExpander.add_row(refineModelEntry)
    refineExpander.add_row(refineSecretRow.row)
    refineExpander.add_row(refineOnErrorRow)
    refineExpander.add_row(refineTestRow.row)
    refineExpander.add_row(instructionsRow)

    const applyRefineWarning = () => {
      const model = refineModelEntry.get_text().trim()
      const missing = []
      if (!model) { missing.push('a refine model') }
      if (!refineSecretRow.hasValue()) { missing.push(`a ${providerLabel(refineProviderId())} API key`) }

      // The Banner rides below the boxed list when Refine is on but its
      // provider is incomplete; Adw.Banner carries no subtitle.
      refineWarning.revealed =
        refineExpander.enable_expansion && missing.length > 0
      if (refineWarning.revealed) {
        refineWarning.title =
          `Missing ${missing.join(' and ')}: voice inputs keep the primary text without refining.`
      }
    }

    // Context matters only when some active role consumes it; the group is
    // hidden otherwise so the UI never offers settings the model ignores.
    const applyContextVisibility = () => {
      const primaryId = PRIMARY_PROVIDER_VALUES[providerRow.selected] ?? 'qwen'
      let used = primaryCapabilities(primaryId)
      if (refineExpander.enable_expansion) {
        used = used || refineCapabilities(refineProviderId())
      }
      contextGroup.visible = used
    }

    providerRow.connect('notify::selected', () => {
      const nextId = PRIMARY_PROVIDER_VALUES[providerRow.selected] ?? 'qwen'
      settings.set_enum('primary-provider', PRIMARY_PROVIDER_VALUES.indexOf(nextId))

      const nextProvider = providerRegistry.get(nextId)
      const nextModel = nextProvider?.manifest?.primary?.fields
        ?.find(f => f.key === 'model')?.default ?? ''
      settings.set_string('primary-model', nextModel)
      modelEntry.set_text(nextModel)

      primarySecretRow.rebind(nextId)
      primarySecretRow.setTitle(`${providerLabel(nextId)} API key`)
      primaryTestRow.rebind()
      applyContextVisibility()
    })

    refineProviderRow.connect('notify::selected', () => {
      const nextId = refineProviderId()
      settings.set_enum('refine-provider', REFINE_PROVIDER_VALUES.indexOf(nextId))
      refineSecretRow.rebind(nextId)
      refineSecretRow.setTitle(`${providerLabel(nextId)} API key`)
      refineTestRow.rebind()
      applyContextVisibility()
      applyRefineWarning()
    })

    refineOnErrorRow.connect('notify::selected', () => {
      const value = REFINE_ON_ERROR_VALUES[refineOnErrorRow.selected] ?? 'fallback'
      settings.set_enum('refine-on-error', REFINE_ON_ERROR_VALUES.indexOf(value))
    })

    refineExpander.connect('notify::enable-expansion', () => {
      settings.set_boolean('refine-enabled', refineExpander.enable_expansion)
      applyContextVisibility()
      applyRefineWarning()
    })

    refineModelEntry.connect('changed', applyRefineWarning)
    // When both roles share a provider, one stored key serves both rows;
    // editing either keeps the other in sync.
    primarySecretRow.onChange(() => { refineSecretRow.refresh(); applyRefineWarning() })
    refineSecretRow.onChange(() => { primarySecretRow.refresh(); applyRefineWarning() })

    processingGroup.add(providerRow)
    processingGroup.add(modelEntry)
    processingGroup.add(primarySecretRow.row)
    processingGroup.add(primaryTestRow.row)
    processingGroup.add(refineExpander)
    // group.add places the Banner below the group's boxed list — the
    // natural end-of-section spot for a warning.
    processingGroup.add(refineWarning)

    // Context: Host-owned free text, not provider configuration. The user
    // decides what belongs in it (terms, background, names); it is sent
    // verbatim only to providers that support it. toas never reads your
    // desktop, editor, clipboard, or files on its own.
    const contextGroup = new Adw.PreferencesGroup({
      title: 'Context',
      description: 'Free text sent to providers that support it: list terms, background, names — anything that helps recognition or refinement. Kept exactly as you write it.'
    })

    // Context: a PreferencesRow whose whole surface is the input — same
    // component as Refine instructions, sized for shorter content.
    const contextRow = textAreaRow(settings, 'context', 'Context', {
      minHeight: 84,
      maxHeight: 160
    })
    contextGroup.add(contextRow)

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
    const qualityRow = new Adw.ComboRow({
      title: 'Audio quality',
      subtitle: 'Standard: ~13 min cap · Balanced: ~9 min · High: ~4 min.',
      model: qualityModel,
      selected: Math.max(0, qualityValues.indexOf(settings.get_enum('audio-quality')))
    })
    qualityRow.connect('notify::selected', () => {
      settings.set_enum('audio-quality', qualityValues[qualityRow.selected] ?? 0)
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
    page.add(contextGroup)
    page.add(securityGroup)
    page.add(recordingGroup)
    page.add(historyGroup)
    window.add(page)

    applyContextVisibility()
    applyRefineWarning()
  }
}

// A multiline entry in the shape of Adw.EntryRow's design model: the
// PreferencesRow itself is the input surface — one level, no nested card.
// A persistent compact caption keeps the field identifiable once text
// fills the row (floating placeholders would hide a known field at
// multiline scale). GSettings binds to GtkTextBuffer's own 'text'
// property bidirectionally; no manual changed-listener round trips.
// The ScrolledWindow gives natural growth up to maxHeight, then scrolls.
function textAreaRow (settings, key, title, { defaultText = '', minHeight = 84, maxHeight = 180 } = {}) {
  const row = new Adw.PreferencesRow({
    activatable: false,
    selectable: false
  })
  row.add_css_class('toas-multiline-row')

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  row.set_child(box)

  const caption = new Gtk.Label({
    label: title,
    xalign: 0,
    margin_top: 10,
    margin_bottom: 2,
    margin_start: 12,
    margin_end: 12
  })
  caption.add_css_class('caption')
  caption.add_css_class('dim-label')
  box.append(caption)

  const buffer = new Gtk.TextBuffer()
  const view = new Gtk.TextView({
    buffer,
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    accepts_tab: false,
    hexpand: true,
    top_margin: 4,
    bottom_margin: 10,
    left_margin: 12,
    right_margin: 12
  })
  view.add_css_class('toas-multiline-text')

  const scrolled = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    has_frame: false,
    min_content_height: minHeight,
    max_content_height: maxHeight,
    propagate_natural_height: true,
    child: view
  })
  box.append(scrolled)

  // The schema default is the fallback when nothing was ever saved; a saved
  // value always wins. Bind after seeding so the first save writes the
  // visible text.
  const stored = settings.get_string(key)
  buffer.set_text(stored || defaultText, -1)
  settings.bind(key, buffer, 'text', Gio.SettingsBindFlags.DEFAULT)

  return row
}

// Loads prefs.css for the Preferences window. The path points at the
// installed extension directory; prefs.css ships with the package.
function loadPrefsCss (path) {
  const provider = new Gtk.CssProvider()
  provider.load_from_path(`${path}/prefs.css`)
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
  )
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

  const refresh = () => {
    const stored = readStored()
    // Never re-assign an identical value: set_text always emits 'changed',
    // and a mutual refresh between two rows sharing one provider would
    // otherwise ping-pong forever.
    if (entry.text !== stored) { entry.text = stored }
  }

  const setTitle = title => {
    entry.title = title
  }

  rebind(providerId)

  return {
    row: entry,
    rebind,
    refresh,
    setTitle,
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
      const configService = new ConfigService({ settings, providers: providerRegistry })
      try {
        await runConnectionTest({ configService, providers: providerRegistry, role })
      } finally {
        configService.destroy()
      }
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
