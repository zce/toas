// Effective configuration resolution shared by the Shell extension and the
// preferences process. Pure GLib: no Shell imports.
//
// Precedence for every field: user override in GSettings, then the documented
// environment variable, then the schema default. API keys are reported as
// presence + source only, never as values.

import GLib from 'gi://GLib'

const DEFAULT_TRANSCRIPTION_ENDPOINT =
    'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
const DEFAULT_TRANSCRIPTION_MODEL = 'mimo-v2.5-asr'
const DEFAULT_REFINE_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const ConfigSource = {
  USER: 'user',
  ENVIRONMENT: 'environment',
  DEFAULT: 'default'
}

function firstNonEmpty (...values) {
  return values.find(value => value !== null && value !== undefined && value !== '') ?? null
}

function readSecret (settings, key, envName) {
  const userValue = settings.get_user_value(key)
    ? settings.get_string(key).trim()
    : ''
  if (userValue) { return { present: true, source: ConfigSource.USER } }

  const envValue = GLib.getenv(envName)
  if (envValue && envValue.trim()) { return { present: true, source: ConfigSource.ENVIRONMENT } }

  return { present: false, source: null }
}

function readString (settings, key, envName, fallback) {
  const userValue = settings.get_user_value(key)
    ? settings.get_string(key).trim()
    : ''
  if (userValue) { return { value: userValue, source: ConfigSource.USER } }

  const envValue = envName ? GLib.getenv(envName) : null
  if (envValue && envValue.trim()) {
    return { value: envValue.trim(), source: ConfigSource.ENVIRONMENT }
  }

  return { value: fallback ?? '', source: ConfigSource.DEFAULT }
}

export function resolveTranscriptionConfig (settings) {
  const endpoint = readString(
    settings,
    'transcription-endpoint',
    'TOAS_TRANSCRIPTION_ENDPOINT',
    DEFAULT_TRANSCRIPTION_ENDPOINT
  )
  const model = readString(
    settings,
    'transcription-model',
    'TOAS_TRANSCRIPTION_MODEL',
    DEFAULT_TRANSCRIPTION_MODEL
  )
  const language = readString(settings, 'transcription-language', null, '')
  const apiKey = readSecret(
    settings,
    'transcription-api-key',
    'TOAS_TRANSCRIPTION_API_KEY'
  )

  const ready = apiKey.present

  return {
    endpoint,
    model,
    language: language.value.trim() || 'auto',
    apiKey,
    ready
  }
}

export function resolveRefineConfig (settings) {
  const enabled = settings.get_boolean('refine-enabled')
  const endpoint = readString(
    settings,
    'refine-endpoint',
    'TOAS_REFINE_ENDPOINT',
    DEFAULT_REFINE_ENDPOINT
  )
  const model = readString(settings, 'refine-model', 'TOAS_REFINE_MODEL', '')
  const apiKey = readSecret(
    settings,
    'refine-api-key',
    'TOAS_REFINE_API_KEY'
  )

  // OPENAI_API_KEY is the final refine key fallback (see refiner.js).
  const apiKeyEffective = apiKey.present ||
        Boolean(GLib.getenv('OPENAI_API_KEY')?.trim())

  const ready = enabled && Boolean(model.value) && apiKeyEffective

  return {
    enabled,
    endpoint,
    model,
    apiKey: { present: apiKeyEffective, source: apiKey.source },
    ready
  }
}

// One-line readiness summaries for notifications and UI labels; never includes
// secret values.
export function describeTranscriptionReadiness (config) {
  if (config.ready) { return null }

  if (config.apiKey.source === ConfigSource.ENVIRONMENT) { return null }

  return 'Transcription API key is missing. Add it in Preferences.'
}

export { DEFAULT_TRANSCRIPTION_ENDPOINT, DEFAULT_TRANSCRIPTION_MODEL, DEFAULT_REFINE_ENDPOINT, firstNonEmpty }