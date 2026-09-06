import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import {
  providerIdsFor,
  readProcessingConfig,
  runConnectionTest,
  snapshotProcessingConfig,
  snapshotProviderSecrets,
  writeProcessingConfig
} from './host/config.js'
import { providers as providerRegistry } from './kernel/providers/registry.js'
import { inspectSelection, secretKey } from './kernel/process.js'

const REFINE_ON_ERROR_VALUES = ['fallback', 'abort']

function buildShortcutControl (settings) {
  const label = new Adw.ShortcutLabel({ disabled_text: 'Disabled' })
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER, child: label })
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

    const processingGroup = new Adw.PreferencesGroup({
      title: 'Processing',
      description: 'Audio is sent to the selected provider after recording.'
    })
    const processingConfig = readProcessingConfig(settings, providerRegistry)
    const saveProcessingConfig = () => writeProcessingConfig(settings, processingConfig)
    const providerLabel = id => providerRegistry.get(id)?.manifest?.label ?? id
    const primaryProviderIds = providerIdsFor(providerRegistry, 'audio')
    const refineProviderIds = providerIdsFor(providerRegistry, 'text', true)

    const contextGroup = new Adw.PreferencesGroup({
      title: 'Context',
      description: 'Names, terms, and background sent to providers that support context.'
    })
    contextGroup.add(textAreaRow(settings, 'context', { minHeight: 140, maxHeight: 260 }))

    let processingRows = []
    const replaceProcessingRows = rows => {
      for (const row of processingRows) { processingGroup.remove(row) }
      processingRows = rows
      for (const row of processingRows) { processingGroup.add(row) }
    }

    const renderProcessing = () => {
      let refreshMeta = () => {}
      const rows = []

      const primaryProviderRow = new Adw.ComboRow({
        title: 'Transcription provider',
        model: Gtk.StringList.new(primaryProviderIds.map(providerLabel)),
        selected: Math.max(0, primaryProviderIds.indexOf(processingConfig.primary.provider))
      })
      primaryProviderRow.connect('notify::selected', () => {
        const id = primaryProviderIds[primaryProviderRow.selected] ?? primaryProviderIds[0]
        if (!id || id === processingConfig.primary.provider) { return }
        processingConfig.primary.provider = id
        processingConfig.primary.values = { ...(providerRegistry.get(id)?.manifest?.defaults?.audio || {}) }
        saveProcessingConfig()
        renderProcessing()
      })
      rows.push(primaryProviderRow)

      const primaryFields = buildProviderRows({
        settings,
        providerId: processingConfig.primary.provider,
        input: 'audio',
        config: processingConfig,
        selection: processingConfig.primary,
        includeProviderFields: true,
        save: saveProcessingConfig,
        onChanged: () => refreshMeta()
      })
      rows.push(...primaryFields.selectionRows, ...primaryFields.providerRows)
      rows.push(buildConnectionRow({ settings, role: 'primary' }).row)

      const refineExpander = new Adw.ExpanderRow({
        title: 'Refine',
        subtitle: 'Additional processing may increase latency and provider usage or cost.',
        show_enable_switch: true,
        enable_expansion: processingConfig.refine.enabled
      })
      const refineProviderRow = new Adw.ComboRow({
        title: 'Provider',
        model: Gtk.StringList.new(refineProviderIds.map(providerLabel)),
        selected: Math.max(0, refineProviderIds.indexOf(processingConfig.refine.provider))
      })
      refineProviderRow.connect('notify::selected', () => {
        const id = refineProviderIds[refineProviderRow.selected] ?? refineProviderIds[0]
        if (!id || id === processingConfig.refine.provider) { return }
        processingConfig.refine.provider = id
        processingConfig.refine.values = { ...(providerRegistry.get(id)?.manifest?.defaults?.text || {}) }
        saveProcessingConfig()
        renderProcessing()
      })
      refineExpander.add_row(refineProviderRow)

      const refineFields = buildProviderRows({
        settings,
        providerId: processingConfig.refine.provider,
        input: 'text',
        config: processingConfig,
        selection: processingConfig.refine,
        includeProviderFields: processingConfig.refine.provider !== processingConfig.primary.provider,
        save: saveProcessingConfig,
        onChanged: () => refreshMeta()
      })
      for (const row of [...refineFields.selectionRows, ...refineFields.providerRows]) {
        refineExpander.add_row(row)
      }

      refineExpander.add_row(textAreaValueRow('Instructions', {
        text: processingConfig.refine.instructions,
        onChanged: text => {
          processingConfig.refine.instructions = text
          saveProcessingConfig()
        },
        minHeight: 120,
        maxHeight: 260
      }))

      const refineOnErrorRow = new Adw.ComboRow({
        title: 'On refine failure',
        model: Gtk.StringList.new(['Use transcription', 'Fail voice input']),
        selected: Math.max(0, REFINE_ON_ERROR_VALUES.indexOf(processingConfig.refine.onError))
      })
      refineOnErrorRow.connect('notify::selected', () => {
        processingConfig.refine.onError = REFINE_ON_ERROR_VALUES[refineOnErrorRow.selected] ?? 'fallback'
        saveProcessingConfig()
      })
      refineExpander.add_row(refineOnErrorRow)
      refineExpander.add_row(buildConnectionRow({ settings, role: 'refine' }).row)
      refineExpander.connect('notify::enable-expansion', () => {
        if (processingConfig.refine.enabled === refineExpander.enable_expansion) { return }
        processingConfig.refine.enabled = refineExpander.enable_expansion
        saveProcessingConfig()
        renderProcessing()
      })
      rows.push(refineExpander)

      const advancedRows = [
        ...primaryFields.advancedRows,
        ...(processingConfig.refine.enabled ? refineFields.advancedRows : [])
      ]
      if (advancedRows.length > 0) {
        const advancedExpander = new Adw.ExpanderRow({ title: 'Advanced' })
        for (const row of advancedRows) { advancedExpander.add_row(row) }
        rows.push(advancedExpander)
      }

      const refineWarning = new Adw.Banner({ title: '' })
      rows.push(refineWarning)

      const securityNote = new Gtk.Label({
        label: 'API keys entered here are stored as plain text in GNOME settings. Environment variables can be used instead.',
        xalign: 0,
        wrap: true
      })
      securityNote.add_css_class('caption')
      securityNote.add_css_class('dimmed')
      securityNote.add_css_class('toas-group-note')
      rows.push(securityNote)

      refreshMeta = () => {
        const resolvedConfig = snapshotProcessingConfig(settings, providerRegistry)
        const secrets = snapshotProviderSecrets(settings, providerRegistry)
        const inspect = (selection, role) => inspectSelection({
          providers: providerRegistry,
          selection,
          providerValues: resolvedConfig.providers[selection.provider] || {},
          role,
          secrets
        })
        const primary = inspect(processingConfig.primary, 'primary')
        const refine = inspect(processingConfig.refine, 'refine')

        contextGroup.visible = Boolean(
          primary.capabilities?.context ||
          (processingConfig.refine.enabled && refine.capabilities?.context)
        )

        refineWarning.revealed = processingConfig.refine.enabled && refine.issues.length > 0
        refineWarning.title = refineWarning.revealed
          ? `Refine: ${refine.issues[0]?.message ?? 'Provider settings need attention'}`
          : ''
      }

      replaceProcessingRows(rows)
      refreshMeta()
    }

    renderProcessing()

    const localGroup = new Adw.PreferencesGroup({
      title: 'Recording & History',
      description: 'Recording quality and local retention.'
    })

    const qualityValues = ['minimum', 'low', 'standard', 'high', 'maximum']
    const qualityRow = new Adw.ComboRow({
      title: 'Audio quality',
      model: Gtk.StringList.new([
        'Minimum · 8 kHz · ~26 min',
        'Low · 12 kHz · ~17 min',
        'Standard · 16 kHz · ~13 min',
        'High · 24 kHz · ~9 min',
        'Maximum · 48 kHz · ~4 min'
      ]),
      selected: Math.max(0, qualityValues.indexOf(settings.get_string('audio-quality')))
    })
    qualityRow.connect('notify::selected', () => {
      settings.set_string('audio-quality', qualityValues[qualityRow.selected] ?? 'standard')
    })

    const minimumRecordingRow = new Adw.SpinRow({
      title: 'Minimum recording',
      subtitle: 'Ignore shorter recordings · milliseconds',
      adjustment: new Gtk.Adjustment({
        lower: 200,
        upper: 2000,
        step_increment: 100,
        page_increment: 100,
        value: settings.get_uint('minimum-recording-duration')
      }),
      digits: 0,
      numeric: true
    })
    minimumRecordingRow.connect('notify::value', () => {
      settings.set_uint('minimum-recording-duration', Math.round(minimumRecordingRow.value))
    })

    localGroup.add(qualityRow)
    localGroup.add(minimumRecordingRow)
    localGroup.add(spinRow(settings, 'history-limit', 'History entries', 1, 1000))
    localGroup.add(spinRow(settings, 'recording-limit', 'Saved recordings', 0, 1000))

    page.add(inputGroup)
    page.add(processingGroup)
    page.add(contextGroup)
    page.add(localGroup)
    window.add(page)
  }
}

// Build only the rows for the currently selected Provider. Provider changes
// rebuild the small Processing group instead of maintaining hidden controls
// for every possible Provider.
function buildProviderRows ({
  settings,
  providerId,
  input,
  config,
  selection,
  includeProviderFields,
  save,
  onChanged
}) {
  const provider = providerRegistry.get(providerId)
  const selectionRows = []
  const providerRows = []
  const advancedRows = []

  if (includeProviderFields) {
    for (const field of provider?.manifest?.fields || []) {
      if (field.type === 'secret') {
        const control = secretRow({ settings, providerId, field })
        control.onChange(onChanged)
        providerRows.push(control.row)
        continue
      }

      const advanced = field.type === 'url' && Object.hasOwn(field, 'default')
      const row = new Adw.EntryRow({
        title: advanced ? `${provider.manifest.label} ${field.label}` : field.label,
        text: String(config.providers[providerId]?.[field.key] ?? field.default ?? '')
      })
      row.connect('changed', () => {
        const values = (config.providers[providerId] ??= {})
        values[field.key] = row.get_text()
        save()
        onChanged()
      })
      ;(advanced ? advancedRows : providerRows).push(row)
    }
  }

  for (const field of (provider?.manifest?.selectionFields || [])) {
    if (field.inputs !== undefined && !field.inputs.includes(input)) { continue }
    selectionRows.push(selectionFieldRow(
      field,
      selection.values[field.key] ?? field.default ?? '',
      value => {
        selection.values[field.key] = value
        save()
        onChanged()
      }
    ))
  }

  return { selectionRows, providerRows, advancedRows }
}

function selectionFieldRow (field, value, onChanged) {
  if (Array.isArray(field.choices) && field.choices.length > 0) {
    const selected = field.choices.findIndex(choice => String(choice.value) === String(value))
    const row = new Adw.ComboRow({
      title: field.label,
      model: Gtk.StringList.new(field.choices.map(choice => choice.label ?? choice.value)),
      selected: Math.max(0, selected)
    })
    row.connect('notify::selected', () => {
      const choice = field.choices[row.selected]
      if (choice) { onChanged(String(choice.value)) }
    })
    return row
  }

  const row = new Adw.EntryRow({ title: field.label, text: String(value) })
  row.connect('changed', () => onChanged(row.get_text()))
  return row
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

function buildTextAreaRow ({ title = null, minHeight, maxHeight }) {
  const row = new Adw.PreferencesRow({ activatable: false, selectable: false })
  row.add_css_class('toas-multiline-row')
  if (!title) { row.add_css_class('toas-multiline-standalone') }

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  row.set_child(box)

  if (title) {
    const caption = new Gtk.Label({ label: title, xalign: 0 })
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
  box.append(new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    min_content_height: minHeight,
    max_content_height: maxHeight,
    propagate_natural_height: true,
    child: view
  }))

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

function secretRow ({ settings, providerId, field }) {
  const entry = new Adw.PasswordEntryRow({ title: field.label })
  const envIcon = new Gtk.Image({
    icon_name: 'emblem-ok-symbolic',
    tooltip_text: 'Using an environment variable'
  })
  entry.add_suffix(envIcon)
  const changeHandlers = []
  const storageKey = secretKey(providerId, field.key)

  const readStored = () => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    return map[storageKey] ?? ''
  }
  const envPresent = () => (field.env ?? []).some(name => Boolean(GLib.getenv(name)?.trim()))
  const updateEnvIndicator = () => { envIcon.visible = !readStored() && envPresent() }

  entry.text = readStored()
  updateEnvIndicator()
  entry.connect('changed', () => {
    const map = settings.get_value('provider-secrets').deep_unpack()
    const value = entry.get_text().trim()
    if (value) { map[storageKey] = value } else { delete map[storageKey] }
    settings.set_value('provider-secrets', new GLib.Variant('a{ss}', map))
    updateEnvIndicator()
    changeHandlers.forEach(handler => handler())
  })

  return { row: entry, onChange: handler => changeHandlers.push(handler) }
}

function buildConnectionRow ({ settings, role }) {
  const description = 'Verify the current settings.'
  const button = new Gtk.Button({ valign: Gtk.Align.CENTER, label: 'Test' })
  const row = new Adw.ActionRow({ title: 'Connection', subtitle: description })
  row.add_suffix(button)
  row.activatable_widget = button

  let busy = false
  button.connect('clicked', async () => {
    if (busy) { return }
    busy = true
    button.sensitive = false
    row.subtitle = 'Testing…'

    try {
      await runConnectionTest({ settings, providers: providerRegistry, role })
      row.subtitle = 'Connection works'
    } catch (error) {
      row.subtitle = error.message ?? 'Could not reach the service'
    } finally {
      busy = false
      button.sensitive = true
    }
  })

  return { row }
}
