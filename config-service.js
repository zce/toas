// Host-side snapshot of the persisted processing configuration, secrets,
// and Context for one processing attempt.
//
// GSettings shape (unreleased — no migration):
// - processing-config: generic JSON product Config and Provider value maps
// - provider-secrets: map keyed "providers/<provider-id>/<field-key>"
// - context: Host-owned free-text Context (not part of Config)
//
// Value precedence for secrets: stored value, then Provider-declared
// environment fallback, then missing. Environment is read only for
// names declared by the registered Provider Manifests.

import GLib from 'gi://GLib'
import { readProcessingConfig } from './processing-config.js'
import { resolveStep } from './kernel/process.js'

export class ConfigService {
  constructor ({ settings, providers }) {
    this._settings = settings
    this._providers = providers
  }

  snapshotConfig () {
    const config = readProcessingConfig(this._settings, this._providers)
    for (const [providerId, provider] of this._providers) {
      const values = config.providers[providerId] ??= {}
      for (const field of provider.manifest.fields || []) {
        if (field.type === 'secret' || values[field.key] != null) { continue }
        for (const envName of field.env || []) {
          const value = GLib.getenv(envName)?.trim()
          if (value) {
            values[field.key] = value
            break
          }
        }
      }
    }
    return config
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
    const text = String(this._settings.get_string?.('context') ?? '').trim()
    return { text }
  }

  // True when the primary role is configured and a credential exists. Used
  // by the first-run guard so an attempt never fails only after speaking.
  // Goes through the same resolve pipeline as an attempt so readiness and
  // capability truth never diverge.
  primaryReady () {
    const secrets = this.snapshotSecrets()
    const config = this.snapshotConfig()

    try {
      resolveStep({
        providers: this._providers,
        selection: config.primary,
        providerValues: config.providers?.[config.primary.provider] || {},
        role: 'primary',
        secrets,
        runtime: { transport: null, clock: { now: () => 0 } }
      })
      return true
    } catch {
      return false
    }
  }

  destroy () {
    this._settings = null
    this._providers = null
  }

}
