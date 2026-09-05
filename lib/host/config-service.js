// Host-side snapshot of the persisted processing configuration, secrets,
// and Custom Terms for one processing attempt.
//
// GSettings shape (final, unreleased — no migration):
// - primary-provider / primary-model / primary-endpoint: primary role
// - refine-*: optional separate Refine (the only execution the GNOME UI
//   exposes; integrated requires an explicitly capable Provider and is
//   validated in the Kernel)
// - provider-secrets: map keyed "providers/<provider-id>/<field-key>"
// - custom-terms: Host-owned free-text Context (not part of Config)
//
// Value precedence for secrets: stored value, then Provider-declared
// environment fallback, then missing. Environment is read only for
// names declared by the registered Provider Manifests.

import GLib from 'gi://GLib'

const REFINE_ON_ERROR_VALUES = ['fallback', 'abort']

export class ConfigService {
  constructor ({ settings, providers }) {
    this._settings = settings
    this._providers = providers
  }

  snapshotConfig () {
    const primaryProvider = this._providerId('primary-provider', 'qwen')

    return {
      primary: {
        provider: primaryProvider,
        endpoint: this._optionalString('primary-endpoint'),
        values: {
          model: this._optionalString('primary-model') ?? this._roleDefault(primaryProvider, 'processing', 'model')
        }
      },
      refine: {
        enabled: this._settings.get_boolean?.('refine-enabled') ?? false,
        execution: 'separate',
        provider: this._settings.get_enum != null
          ? this._providerId('refine-provider', null)
          : null,
        endpoint: this._optionalString('refine-endpoint'),
        values: {
          model: this._optionalString('refine-model')
        },
        instructions: this._settings.get_string?.('refine-instructions')?.trim() || '',
        onError: this._refineOnError()
      }
    }
  }

  // Resolves the effective secret map for the attempt: stored values, then
  // Manifest-declared environment fallbacks. Secret values never enter Config.
  snapshotSecrets () {
    const secrets = {}
    const stored = this._settings.get_value('provider-secrets')?.deep_unpack() ?? {}

    for (const [storageKey, value] of Object.entries(stored)) {
      const trimmed = String(value ?? '').trim()
      if (trimmed) { secrets[storageKey] = trimmed }
    }

    for (const [providerId, provider] of this._providers) {
      for (const field of provider.manifest.fields || []) {
        if (field.type !== 'secret') { continue }

        const key = `providers/${providerId}/${field.key}`
        if (secrets[key]) { continue }

        for (const envName of field.env || []) {
          const value = GLib.getenv(envName)?.trim()
          if (value) {
            secrets[key] = value
            break
          }
        }
      }
    }

    return secrets
  }

  // The Context is Host-owned free text (a Host setting, not part of
  // Config): the user decides what belongs in it — terms, background,
  // names, any bias text. It is passed to the Kernel verbatim.
  snapshotContext () {
    const text = String(this._settings.get_string?.('custom-terms') ?? '').trim()
    return { text }
  }

  // True when the primary role is configured and a credential exists. Used
  // by the first-run guard so an attempt never fails only after speaking.
  primaryReady () {
    const secrets = this.snapshotSecrets()
    const config = this.snapshotConfig()
    const provider = this._providers.get(config.primary.provider)
    if (!provider) { return false }

    const keyField = (provider.manifest.fields || []).find(f => f.type === 'secret')
    if (!keyField) { return false }
    if (!secrets[`providers/${config.primary.provider}/${keyField.key}`]) { return false }

    return Boolean(config.primary.values.model)
  }

  destroy () {
    this._settings = null
    this._providers = null
  }

  _providerId (key, fallback) {
    try {
      const value = this._settings.get_enum(key)
      const names = PROVIDER_ENUM_NAMES[key] ?? []
      return names[value] ?? fallback
    } catch {
      return fallback
    }
  }

  _optionalString (key) {
    const value = this._settings.get_string?.(key)
    if (typeof value !== 'string') { return null }
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  _refineOnError () {
    const onError = this._settings.get_enum?.('refine-on-error')
    return REFINE_ON_ERROR_VALUES[onError] ?? 'fallback'
  }

  _roleDefault (providerId, role, fieldKey) {
    const provider = this._providers.get(providerId)
    const field = provider?.manifest?.[role]?.fields?.find(f => f.key === fieldKey)
    return field?.default ?? null
  }
}

// Numeric values of the schema enums in declaration order; get_enum returns
// numbers, not nicks.
const PROVIDER_ENUM_NAMES = {
  'primary-provider': ['qwen', 'mimo'],
  'refine-provider': ['mimo', 'openai', 'openai-compatible']
}
