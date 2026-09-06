// Host-owned privacy preference. GSettings is the only durable source of
// truth; this adapter deliberately caches no runtime boolean.
export class PrivacyPreference {
  constructor (settings) {
    this._settings = settings
  }

  get enabled () {
    return this._settings.get_boolean('private-mode')
  }

  set enabled (enabled) {
    this._settings.set_boolean('private-mode', Boolean(enabled))
  }
}
