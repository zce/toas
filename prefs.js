import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { providers as providerRegistry } from './lib/kernel/providers/registry.js'
import { secretKey, prepareResolveInput } from './lib/kernel/process.js'
import { ConfigService } from './lib/host/config-service.js'
import { runConnectionTest } from './lib/host/connection-check.js'
import { readProcessingConfig, writeProcessingConfig, providerIdsFor } from './lib/host/processing-config.js'
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

    const processingConfig = readProcessingConfig(settings, providerRegistry)
    const saveProcessingConfig = () => writeProcessingConfig(settings, processingConfig)
    const providerLabel = id => providerRegistry.get(id)?.manifest?.label ?? id
    const primaryProviderIds = providerIdsFor(providerRegistry, 'audio')
    const refineProviderIds = providerIdsFor(providerRegistry, 'text', true)
    const primaryProviderId = () => primaryProviderIds[providerRow.selected] ?? primaryProviderIds[0]
    const refineProviderId = () => refineProviderIds[refineProviderRow.selected] ?? refineProviderIds[0]

    const providerRow = new Adw.ComboRow({
      title: 'Primary provider',
      subtitle: 'Processes your recording into text',
      model: Gtk.StringList.new(primaryProviderIds.map(providerLabel)),
      selected: Math.max(0, primaryProviderIds.indexOf(processingConfig.primary.provider))
    })

    const primaryFields = dynamicFieldRows({
      settings,
      providers: providerRegistry,
      providerIds: primaryProviderIds,
      providerId: primaryProviderId,
      input: 'audio',
      config: processingConfig,
      save: saveProcessingConfig,
      selection: processingConfig.primary
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
      model: Gtk.StringList.new(refineProviderIds.map(providerLabel)),
      selected: Math.max(0, refineProviderIds.indexOf(processingConfig.refine.provider))
    })
    const refineFields = dynamicFieldRows({
      settings,
      providers: providerRegistry,
      providerIds: refineProviderIds,
      providerId: refineProviderId,
      input: 'text',
      config: processingConfig,
      save: saveProcessingConfig,
      selection: processingConfig.refine
    })

    const refineOnErrorRow = new Adw.ComboRow({
      title: 'Failure behavior',
      subtitle: 'What happens when refine fails after primary processing succeeds.',
      model: Gtk.StringList.new(['Insert primary text', 'Fail the voice input']),
      selected: Math.max(0, REFINE_ON_ERROR_VALUES.indexOf(
        processingConfig.refine.onError
      ))
    })

    const refineTestRow = buildConnectionRow({
      settings,
      role: 'refine',
      label: 'Test connection',
      description: 'Sends a short fixed text through the same refine path as a real voice input.'
    })

    const refineWarning = new Adw.Banner({ title: '' })

    // Refine Instructions: a PreferencesRow whose whole surface is the
    // input, EntryRow's design language at multiline scale. The persistent
    // compact title keeps the field identifiable once text fills the row.
    const instructionsRow = textAreaValueRow('Refine instructions', {
      text: processingConfig.refine.instructions,
      onChanged: text => {
        processingConfig.refine.instructions = text
        saveProcessingConfig()
      },
      minHeight: 84,
      maxHeight: 200
    })

    // The enable switch updates Product Config directly; while off, the
    // nested settings stay collapsed and inaccessible.
    const refineExpander = new Adw.ExpanderRow({
      title: 'Refine',
      subtitle: 'Applies your instructions to the primary text with a second service. Disable for literal dictation.',
      show_enable_switch: true,
      enable_expansion: processingConfig.refine.enabled
    })

    refineExpander.add_row(refineProviderRow)
    refineFields.rows.forEach(row => refineExpander.add_row(row))
    refineExpander.add_row(refineOnErrorRow)
    refineExpander.add_row(refineTestRow.row)
    refineExpander.add_row(instructionsRow)

    const applyRefineWarning = () => {
      const model = String(processingConfig.refine.values.model || '').trim()
      const missing = []
      if (!model) { missing.push('a refine model') }
      if (!refineFields.secretsPresent()) { missing.push(`a ${providerLabel(refineProviderId())} API key`) }

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
      let used = resolvedCapabilities(processingConfig.primary, processingConfig, providerRegistry)?.context
      if (refineExpander.enable_expansion) {
        used = used || resolvedCapabilities(processingConfig.refine, processingConfig, providerRegistry)?.context
      }
      contextGroup.visible = used
    }

    providerRow.connect('notify::selected', () => {
      const nextId = primaryProviderId()
      processingConfig.primary.provider = nextId
      processingConfig.primary.values = { ...(providerRegistry.get(nextId)?.manifest?.defaults?.audio || {}) }
      saveProcessingConfig()
      primaryFields.refresh()
      primaryTestRow.resetStatus()
      applyContextVisibility()
    })

    refineProviderRow.connect('notify::selected', () => {
      const nextId = refineProviderId()
      processingConfig.refine.provider = nextId
      processingConfig.refine.values = { ...(providerRegistry.get(nextId)?.manifest?.defaults?.text || {}) }
      saveProcessingConfig()
      refineFields.refresh()
      refineTestRow.resetStatus()
      applyContextVisibility()
      applyRefineWarning()
    })

    refineOnErrorRow.connect('notify::selected', () => {
      const value = REFINE_ON_ERROR_VALUES[refineOnErrorRow.selected] ?? 'fallback'
      processingConfig.refine.onError = value
      saveProcessingConfig()
    })

    refineExpander.connect('notify::enable-expansion', () => {
      processingConfig.refine.enabled = refineExpander.enable_expansion
      saveProcessingConfig()
      applyContextVisibility()
      applyRefineWarning()
    })

    primaryFields.onChange(() => { refineFields.refresh(); applyContextVisibility() })
    refineFields.onChange(() => { primaryFields.refresh(); applyContextVisibility(); applyRefineWarning() })

    processingGroup.add(providerRow)
    primaryFields.rows.forEach(row => processingGroup.add(row))
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

// Builds controls from Manifest fields while keeping persisted Provider maps
// opaque to Preferences. Rows are reused when the selected Provider changes;
// fields not declared by that Provider are hidden.
function dynamicFieldRows ({ settings, providers, providerIds, providerId, input, config, save, selection }) {
  const changed = []
  let refreshing = false
  const rows = []

  const fieldKeys = (source) => [...new Set(providerIds.flatMap(id =>
    (source(providers.get(id)) || []).map(field => field.key)))]

  const valueRows = []
  for (const scope of ['provider', 'selection']) {
    const source = provider => scope === 'provider'
      ? provider?.manifest?.fields?.filter(field => field.type !== 'secret')
      : provider?.manifest?.selectionFields?.filter(field =>
        field.inputs === undefined || field.inputs.includes(input))

    for (const key of fieldKeys(source)) {
      const row = new Adw.EntryRow({ title: key })
      row.connect('changed', () => {
        if (refreshing) { return }
        const id = providerId()
        const target = scope === 'provider'
          ? (config.providers[id] ??= {})
          : selection.values
        target[key] = row.get_text()
        save()
        changed.forEach(handler => handler())
      })
      valueRows.push({ row, key, scope, source })
      rows.push(row)
    }
  }

  const secretKeys = fieldKeys(provider =>
    provider?.manifest?.fields?.filter(field => field.type === 'secret'))
  const secretRows = secretKeys.map(key => {
    const control = secretRow({ settings, providerId: providerIds[0], fieldKey: key, title: key })
    control.onChange(() => changed.forEach(handler => handler()))
    rows.push(control.row)
    return { key, control }
  })

  const refresh = () => {
    refreshing = true
    const id = providerId()
    const provider = providers.get(id)
    const providerValues = config.providers[id] || {}

    for (const item of valueRows) {
      const field = (item.source(provider) || []).find(candidate => candidate.key === item.key)
      item.row.visible = Boolean(field)
      if (!field) { continue }
      item.row.title = field.label
      const target = item.scope === 'provider' ? providerValues : selection.values
      item.row.set_text(String(target[item.key] ?? field.default ?? ''))
    }

    for (const item of secretRows) {
      const field = provider?.manifest?.fields?.find(candidate =>
        candidate.type === 'secret' && candidate.key === item.key)
      item.control.row.visible = Boolean(field)
      if (!field) { continue }
      item.control.rebind(id, item.key)
      item.control.setTitle(field.label)
    }
    refreshing = false
  }

  refresh()
  return {
    rows,
    refresh,
    secretsPresent: () => secretRows
      .filter(item => item.control.row.visible)
      .every(item => item.control.hasValue()),
    onChange: handler => changed.push(handler)
  }
}

// One resolve() call against the current selection, for UI visibility
// decisions. Capabilities depend on the selection, not on credentials:
// Providers report them alongside any credential issues, so the probe needs
// no secrets.
function resolvedCapabilities (selection, config, providers) {
  const provider = providers.get(selection.provider)
  const { providerValues } = prepareResolveInput(
    provider.manifest.fields || [],
    selection.provider,
    config.providers[selection.provider] || {}
  )
  return provider.resolve({ providerValues, values: selection.values, secretPresence: {} }).capabilities
}

function textAreaValueRow (title, { text = '', onChanged, minHeight = 84, maxHeight = 180 } = {}) {
  const { row, buffer } = buildTextAreaRow(title, minHeight, maxHeight)
  buffer.set_text(text, -1)
  buffer.connect('changed', () => onChanged(buffer.text))
  return row
}

// A multiline entry in the shape of Adw.EntryRow's design model: the
// PreferencesRow itself is the input surface — one level, no nested card.
// A persistent compact caption keeps the field identifiable once text
// fills the row (floating placeholders would hide a known field at
// multiline scale). GSettings binds to GtkTextBuffer's own 'text'
// property bidirectionally; no manual changed-listener round trips.
// The ScrolledWindow gives natural growth up to maxHeight, then scrolls.
function textAreaRow (settings, key, title, { defaultText = '', minHeight = 84, maxHeight = 180 } = {}) {
  const { row, buffer } = buildTextAreaRow(title, minHeight, maxHeight)

  // The schema default is the fallback when nothing was ever saved; a saved
  // value always wins. Bind after seeding so the first save writes the
  // visible text.
  const stored = settings.get_string(key)
  buffer.set_text(stored || defaultText, -1)
  settings.bind(key, buffer, 'text', Gio.SettingsBindFlags.DEFAULT)

  return row
}

function buildTextAreaRow (title, minHeight, maxHeight) {
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

  return { row, buffer }
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
  let rebinding = false

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
    if (rebinding) { return }
    writeStored(entry.get_text().trim())
  })

  // Rebinding to another Provider or field loads that stored value. Never
  // re-assign an identical value: set_text always emits 'changed', and the
  // write-through would otherwise fire for a pure read.
  const rebind = (nextProviderId, nextFieldKey = fieldKey) => {
    providerId = nextProviderId
    fieldKey = nextFieldKey
    const stored = readStored()
    if (entry.text !== stored) {
      rebinding = true
      entry.text = stored
      rebinding = false
    }
  }

  const setTitle = title => {
    entry.title = title
  }

  rebind(providerId)

  return {
    row: entry,
    rebind,
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

  return { row, resetStatus: () => setStatus(description) }
}
