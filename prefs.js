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

function buildShortcutControl (settings) {
  const label = new Adw.ShortcutLabel({
    disabled_text: 'Disabled'
  })
  const button = new Gtk.Button({
    valign: Gtk.Align.CENTER,
    child: label
  })
  button.add_css_class('flat')

  const showShortcut = () => {
    label.accelerator = settings.get_strv('push-to-talk')[0] || ''
    label.disabled_text = 'Disabled'
  }

  const showPrompt = text => {
    label.accelerator = ''
    label.disabled_text = text
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
    showShortcut()
  }

  button.connect('clicked', () => {
    if (editing) {
      stopEditing()
      return
    }

    editing = true
    showPrompt('Press shortcut…')

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
        showPrompt('Add a key…')
        return Gdk.EVENT_STOP
      }

      const accelerator = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask)
      if (!accelerator || !Gtk.accelerator_valid(keyval, mask)) {
        showPrompt('Invalid shortcut')
        return Gdk.EVENT_STOP
      }

      label.accelerator = accelerator
      label.disabled_text = ''

      debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        debounceId = 0
        settings.set_strv('push-to-talk', [accelerator])
        stopEditing()
        return GLib.SOURCE_REMOVE
      })

      return Gdk.EVENT_STOP
    })
  })

  showShortcut()
  return button
}

export default class ToasPreferences extends ExtensionPreferences {
  fillPreferencesWindow (window) {
    const settings = this.getSettings()

    loadPrefsCss(this.path)
    window.search_enabled = false

    const page = new Adw.PreferencesPage({
      title: 'toas',
      icon_name: 'audio-input-microphone-symbolic'
    })

    // --- Voice Input ---------------------------------------------------------

    const inputGroup = new Adw.PreferencesGroup({
      title: 'Voice Input',
      description: 'Hold the shortcut to record, then release to process.'
    })

    const shortcutControl = buildShortcutControl(settings)
    const shortcutRow = new Adw.ActionRow({ title: 'Shortcut' })
    shortcutRow.add_suffix(shortcutControl)
    shortcutRow.activatable_widget = shortcutControl

    const autoInsert = new Adw.SwitchRow({
      title: 'Insert automatically',
      subtitle: 'Insert the result into the focused app; otherwise copy it to the clipboard.'
    })
    settings.bind('auto-paste', autoInsert, 'active', Gio.SettingsBindFlags.DEFAULT)

    const restoreClipboard = new Adw.SwitchRow({
      title: 'Restore clipboard',
      subtitle: 'Restore the previous clipboard text after insertion.'
    })
    settings.bind('restore-clipboard', restoreClipboard, 'active', Gio.SettingsBindFlags.DEFAULT)
    settings.bind('auto-paste', restoreClipboard, 'visible', Gio.SettingsBindFlags.GET)

    inputGroup.add(shortcutRow)
    inputGroup.add(autoInsert)
    inputGroup.add(restoreClipboard)

    // --- Processing ----------------------------------------------------------

    const processingGroup = new Adw.PreferencesGroup({
      title: 'Processing',
      description: 'Audio is sent to the selected provider after recording.'
    })

    const processingConfig = readProcessingConfig(settings, providerRegistry)
    const saveProcessingConfig = () => writeProcessingConfig(settings, processingConfig)
    const providerLabel = id => providerRegistry.get(id)?.manifest?.label ?? id
    const primaryProviderIds = providerIdsFor(providerRegistry, 'audio')
    const refineProviderIds = providerIdsFor(providerRegistry, 'text', true)
    const primaryProviderId = () => primaryProviderIds[providerRow.selected] ?? primaryProviderIds[0]
    const refineProviderId = () => refineProviderIds[refineProviderRow.selected] ?? refineProviderIds[0]

    const providerRow = new Adw.ComboRow({
      title: 'Transcription provider',
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

    const primaryTestRow = buildConnectionRow({ settings, role: 'primary' })

    const refineProviderRow = new Adw.ComboRow({
      title: 'Provider',
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

    const instructionsRow = textAreaValueRow('Instructions', {
      text: processingConfig.refine.instructions,
      onChanged: text => {
        processingConfig.refine.instructions = text
        saveProcessingConfig()
      },
      minHeight: 92,
      maxHeight: 220
    })

    const refineOnErrorRow = new Adw.ComboRow({
      title: 'On refine failure',
      model: Gtk.StringList.new(['Use transcription', 'Fail voice input']),
      selected: Math.max(0, REFINE_ON_ERROR_VALUES.indexOf(processingConfig.refine.onError))
    })

    const refineTestRow = buildConnectionRow({ settings, role: 'refine' })

    const refineExpander = new Adw.ExpanderRow({
      title: 'Refine',
      subtitle: 'Improve the transcript with additional instructions.',
      show_enable_switch: true,
      enable_expansion: processingConfig.refine.enabled
    })

    refineExpander.add_row(refineProviderRow)
    refineFields.selectionRows.forEach(row => refineExpander.add_row(row))
    refineFields.providerRows.forEach(row => refineExpander.add_row(row))
    refineExpander.add_row(instructionsRow)
    refineExpander.add_row(refineOnErrorRow)
    refineExpander.add_row(refineTestRow.row)

    const advancedExpander = new Adw.ExpanderRow({ title: 'Advanced' })
    primaryFields.advancedRows.forEach(row => advancedExpander.add_row(row))
    refineFields.advancedRows.forEach(row => advancedExpander.add_row(row))

    const refineWarning = new Adw.Banner({ title: '' })

    // Context is product-owned free text and only appears when an active
    // selection can consume it. The group already labels the field, so this
    // uses the standalone multiline variant without an internal caption.
    const contextGroup = new Adw.PreferencesGroup({
      title: 'Context',
      description: 'Names, terms, and background sent to providers that support context.'
    })
    const contextRow = textAreaRow(settings, 'context', {
      minHeight: 92,
      maxHeight: 180
    })
    contextGroup.add(contextRow)

    const applyContextVisibility = () => {
      let used = resolvedCapabilities(processingConfig.primary, processingConfig, providerRegistry)?.context
      if (refineExpander.enable_expansion) {
        used = used || resolvedCapabilities(processingConfig.refine, processingConfig, providerRegistry)?.context
      }
      contextGroup.visible = Boolean(used)
    }

    const applyRefineWarning = () => {
      const model = String(processingConfig.refine.values.model || '').trim()
      const missing = []
      if (!model) { missing.push('a model') }
      if (!refineFields.secretsPresent()) {
        missing.push(`${providerLabel(refineProviderId())} API key`)
      }

      refineWarning.revealed = refineExpander.enable_expansion && missing.length > 0
      if (refineWarning.revealed) {
        refineWarning.title = `Refine needs ${missing.join(' and ')}`
      }
    }

    const syncProcessingVisibility = () => {
      // Provider configuration is shared by provider id. If transcription and
      // Refine use the same service, show endpoint/key once instead of making
      // the product architecture look duplicated to the user.
      refineFields.setProviderFieldsVisible(
        refineExpander.enable_expansion && refineProviderId() !== primaryProviderId()
      )
      advancedExpander.visible =
        primaryFields.hasVisibleAdvanced() || refineFields.hasVisibleAdvanced()
    }

    providerRow.connect('notify::selected', () => {
      const nextId = primaryProviderId()
      processingConfig.primary.provider = nextId
      processingConfig.primary.values = { ...(providerRegistry.get(nextId)?.manifest?.defaults?.audio || {}) }
      saveProcessingConfig()
      primaryFields.refresh()
      primaryTestRow.resetStatus()
      syncProcessingVisibility()
      applyContextVisibility()
      applyRefineWarning()
    })

    refineProviderRow.connect('notify::selected', () => {
      const nextId = refineProviderId()
      processingConfig.refine.provider = nextId
      processingConfig.refine.values = { ...(providerRegistry.get(nextId)?.manifest?.defaults?.text || {}) }
      saveProcessingConfig()
      refineFields.refresh()
      refineTestRow.resetStatus()
      syncProcessingVisibility()
      applyContextVisibility()
      applyRefineWarning()
    })

    refineOnErrorRow.connect('notify::selected', () => {
      processingConfig.refine.onError =
        REFINE_ON_ERROR_VALUES[refineOnErrorRow.selected] ?? 'fallback'
      saveProcessingConfig()
    })

    refineExpander.connect('notify::enable-expansion', () => {
      processingConfig.refine.enabled = refineExpander.enable_expansion
      saveProcessingConfig()
      syncProcessingVisibility()
      applyContextVisibility()
      applyRefineWarning()
    })

    primaryFields.onChange(() => {
      applyContextVisibility()
      applyRefineWarning()
    })
    refineFields.onChange(() => {
      applyContextVisibility()
      applyRefineWarning()
    })

    processingGroup.add(providerRow)
    primaryFields.selectionRows.forEach(row => processingGroup.add(row))
    primaryFields.providerRows.forEach(row => processingGroup.add(row))
    processingGroup.add(primaryTestRow.row)
    processingGroup.add(refineExpander)
    processingGroup.add(advancedExpander)
    processingGroup.add(refineWarning)

    const securityNote = new Gtk.Label({
      label: 'API keys entered here are stored as plain text in GNOME settings. Environment variables can be used instead.',
      xalign: 0,
      wrap: true
    })
    securityNote.add_css_class('caption')
    securityNote.add_css_class('dimmed')
    securityNote.add_css_class('toas-group-note')
    processingGroup.add(securityNote)

    // --- Recording & History -------------------------------------------------

    const localGroup = new Adw.PreferencesGroup({
      title: 'Recording & History',
      description: 'Recording quality and local retention.'
    })

    // Present presets in semantic order without changing persisted enum values:
    // standard=0, balanced=2, high=1.
    const qualityValues = [0, 2, 1]
    const qualityRow = new Adw.ComboRow({
      title: 'Audio quality',
      model: Gtk.StringList.new([
        'Standard · 16 kHz · ~13 min',
        'Balanced · 24 kHz · ~9 min',
        'High · 48 kHz · ~4 min'
      ]),
      selected: Math.max(0, qualityValues.indexOf(settings.get_enum('audio-quality')))
    })
    qualityRow.connect('notify::selected', () => {
      settings.set_enum('audio-quality', qualityValues[qualityRow.selected] ?? 0)
    })

    localGroup.add(qualityRow)
    localGroup.add(spinRow(settings, 'history-limit', 'History entries', 1, 1000))
    localGroup.add(spinRow(settings, 'recording-limit', 'Saved recordings', 1, 1000))

    page.add(inputGroup)
    page.add(processingGroup)
    page.add(contextGroup)
    page.add(localGroup)
    window.add(page)

    syncProcessingVisibility()
    applyContextVisibility()
    applyRefineWarning()
  }
}

// Build rows from Provider manifests while keeping product UI concerns out of
// Providers. Selection fields and shared Provider fields are returned
// separately so Preferences can present them according to the user's task.
function dynamicFieldRows ({ settings, providers, providerIds, providerId, input, config, save, selection }) {
  const changed = []
  const controls = []
  let refreshing = false
  let providerFieldsVisible = true

  const emitChanged = () => changed.forEach(handler => handler())
  const appliesToInput = field =>
    field.inputs === undefined || field.inputs.includes(input)

  for (const id of providerIds) {
    const provider = providers.get(id)
    if (!provider) { continue }

    for (const field of provider.manifest.fields || []) {
      if (field.type === 'secret') {
        const control = secretRow({
          settings,
          providerId: id,
          fieldKey: field.key,
          title: field.label
        })
        control.onChange(emitChanged)
        controls.push({
          id,
          field,
          scope: 'provider',
          advanced: false,
          kind: 'secret',
          row: control.row,
          control
        })
        continue
      }

      const advanced = field.type === 'url' && Object.hasOwn(field, 'default')
      const row = new Adw.EntryRow({
        title: advanced ? `${provider.manifest.label} ${field.label}` : field.label
      })
      row.connect('changed', () => {
        if (refreshing || providerId() !== id) { return }
        const target = (config.providers[id] ??= {})
        target[field.key] = row.get_text()
        save()
        emitChanged()
      })
      controls.push({ id, field, scope: 'provider', advanced, kind: 'value', row })
    }

    for (const field of (provider.manifest.selectionFields || []).filter(appliesToInput)) {
      const control = selectionFieldControl(field, value => {
        if (refreshing || providerId() !== id) { return }
        selection.values[field.key] = value
        save()
        emitChanged()
      })
      controls.push({ id, field, scope: 'selection', advanced: false, kind: 'selection', ...control })
    }
  }

  const refresh = () => {
    refreshing = true
    const currentId = providerId()
    const providerValues = config.providers[currentId] || {}

    for (const item of controls) {
      item.row.visible = item.id === currentId &&
        (item.scope === 'selection' || providerFieldsVisible)

      if (item.id !== currentId) { continue }

      if (item.kind === 'value') {
        const target = item.scope === 'provider' ? providerValues : selection.values
        const value = target[item.field.key] ?? item.field.default ?? ''
        if (item.row.get_text() !== String(value)) {
          item.row.set_text(String(value))
        }
      } else if (item.kind === 'selection') {
        const value = selection.values[item.field.key] ?? item.field.default ?? ''
        item.setValue(String(value))
      }
    }
    refreshing = false
  }

  const selectionRows = controls
    .filter(item => item.scope === 'selection')
    .map(item => item.row)
  const providerRows = controls
    .filter(item => item.scope === 'provider' && !item.advanced)
    .map(item => item.row)
  const advancedRows = controls
    .filter(item => item.advanced)
    .map(item => item.row)

  refresh()

  return {
    selectionRows,
    providerRows,
    advancedRows,
    refresh,
    setProviderFieldsVisible: visible => {
      providerFieldsVisible = visible
      refresh()
    },
    hasVisibleAdvanced: () => advancedRows.some(row => row.visible),
    secretsPresent: () => controls
      .filter(item => item.id === providerId() && item.kind === 'secret')
      .every(item => item.control.hasValue()),
    onChange: handler => changed.push(handler)
  }
}

function selectionFieldControl (field, onChanged) {
  if (Array.isArray(field.choices) && field.choices.length > 0) {
    const row = new Adw.ComboRow({
      title: field.label,
      model: Gtk.StringList.new(field.choices.map(choice => choice.label ?? choice.value))
    })
    row.connect('notify::selected', () => {
      const choice = field.choices[row.selected]
      if (choice) { onChanged(String(choice.value)) }
    })
    return {
      row,
      setValue: value => {
        const index = field.choices.findIndex(choice => String(choice.value) === value)
        row.selected = Math.max(0, index)
      }
    }
  }

  const row = new Adw.EntryRow({ title: field.label })
  row.connect('changed', () => onChanged(row.get_text()))
  return {
    row,
    setValue: value => {
      if (row.get_text() !== value) { row.set_text(value) }
    }
  }
}

// Capabilities depend on the resolved selection, not credentials. Providers
// report them alongside credential issues, so this probe needs no secrets.
function resolvedCapabilities (selection, config, providers) {
  const provider = providers.get(selection.provider)
  const { providerValues } = prepareResolveInput(
    provider.manifest.fields || [],
    selection.provider,
    config.providers[selection.provider] || {}
  )
  return provider.resolve({ providerValues, values: selection.values, secretPresence: {} }).capabilities
}

function textAreaValueRow (title, { text = '', onChanged, minHeight = 92, maxHeight = 200 } = {}) {
  const { row, buffer } = buildTextAreaRow({ title, minHeight, maxHeight })
  buffer.set_text(text, -1)
  buffer.connect('changed', () => onChanged(buffer.text))
  return row
}

function textAreaRow (settings, key, { defaultText = '', minHeight = 92, maxHeight = 180 } = {}) {
  const { row, buffer } = buildTextAreaRow({ minHeight, maxHeight })
  const stored = settings.get_string(key)
  buffer.set_text(stored || defaultText, -1)
  settings.bind(key, buffer, 'text', Gio.SettingsBindFlags.DEFAULT)
  return row
}

// Two visual forms share one editor implementation: embedded rows carry a
// compact field caption, while standalone rows rely on their surrounding
// PreferencesGroup for identity and render as a pure text area.
function buildTextAreaRow ({ title = null, minHeight, maxHeight }) {
  const row = new Adw.PreferencesRow({
    activatable: false,
    selectable: false
  })
  row.add_css_class('toas-multiline-row')
  if (!title) { row.add_css_class('toas-multiline-standalone') }

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  row.set_child(box)

  if (title) {
    const caption = new Gtk.Label({
      label: title,
      xalign: 0
    })
    caption.add_css_class('caption')
    caption.add_css_class('toas-multiline-caption')
    box.append(caption)
  }

  const buffer = new Gtk.TextBuffer()
  const view = new Gtk.TextView({
    buffer,
    wrap_mode: Gtk.WrapMode.WORD_CHAR,
    accepts_tab: false,
    hexpand: true
  })

  const scrolled = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    min_content_height: minHeight,
    max_content_height: maxHeight,
    propagate_natural_height: true,
    child: view
  })
  box.append(scrolled)

  return { row, buffer }
}

function loadPrefsCss (path) {
  const provider = new Gtk.CssProvider()
  provider.load_from_path(`${path}/prefs.css`)
  Gtk.StyleContext.add_provider_for_display(
    Gdk.Display.get_default(),
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
  )
}

function spinRow (settings, key, title, lower, upper) {
  const row = new Adw.SpinRow({
    title,
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

// Secrets are stored only in provider-secrets. Empty means the Provider can
// fall back to its declared environment variables; environment values are
// never copied into the UI.
function secretRow ({ settings, providerId, fieldKey, title }) {
  const entry = new Adw.PasswordEntryRow({ title })
  const envIcon = new Gtk.Image({
    icon_name: 'emblem-ok-symbolic',
    tooltip_text: 'Using an environment variable'
  })
  entry.add_suffix(envIcon)

  const changeHandlers = []

  const readStored = () => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    return map[secretKey(providerId, fieldKey)] ?? ''
  }

  const updateEnvIndicator = () => {
    envIcon.visible = !readStored() && envFallbackPresent(providerId, fieldKey)
  }

  const writeStored = value => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    const key = secretKey(providerId, fieldKey)
    if (value) { map[key] = value } else { delete map[key] }
    settings.set_value('provider-secrets', new GLib.Variant('a{ss}', map))
    updateEnvIndicator()
    changeHandlers.forEach(handler => handler())
  }

  entry.text = readStored()
  updateEnvIndicator()

  entry.connect('changed', () => {
    writeStored(entry.get_text().trim())
  })

  return {
    row: entry,
    hasValue: () => Boolean(readStored() || envFallbackPresent(providerId, fieldKey)),
    onChange: handler => changeHandlers.push(handler)
  }
}

function envFallbackPresent (providerId, fieldKey) {
  const provider = providerRegistry.get(providerId)
  const field = (provider?.manifest?.fields ?? []).find(f => f.key === fieldKey)
  return (field?.env ?? []).some(name => Boolean(GLib.getenv(name)?.trim()))
}

function buildConnectionRow ({ settings, role }) {
  const description = 'Verify the current settings.'
  const button = new Gtk.Button({
    valign: Gtk.Align.CENTER,
    label: 'Test'
  })
  const row = new Adw.ActionRow({
    title: 'Connection',
    subtitle: description
  })
  row.add_suffix(button)
  row.activatable_widget = button

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
      setStatus('Connection works')
    } catch (error) {
      setStatus(error.message ?? 'Could not reach the service')
    } finally {
      busy = false
      button.sensitive = true
    }
  })

  return { row, resetStatus: () => setStatus(description) }
}
