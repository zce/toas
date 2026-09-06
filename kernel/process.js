// Runtime-agnostic processing kernel.
// A plan is one primary audio-to-text Step plus an optional Refine text Step.
// Provider selection resolves before Processor creation or I/O, and
// cancellation never degrades into a fallback result.

import { processingError } from './error.js'

export { processingError } from './error.js'

export async function process ({ config, audio, context, secrets, runtime, signal, providers }) {
  if (signal?.aborted) {
    throw processingError('cancelled', 'Processing was cancelled')
  }

  validateConfigShape(config)
  if (!providers) {
    throw processingError('configuration', 'Provider registry is missing')
  }

  const contextSnapshot = normalizeContext(context)
  const primary = createStep({
    providers,
    selection: config.primary,
    providerValues: config.providers?.[config.primary.provider] || {},
    role: 'primary',
    secrets,
    runtime
  })
  const primaryTrace = traceFor({ resolved: primary, context: contextSnapshot })

  if (!config.refine.enabled) {
    return await runPrimary({ primary, primaryTrace, audio, context: contextSnapshot, runtime, signal })
  }

  return await runRefine({
    primary,
    primaryTrace,
    refineConfig: config.refine,
    audio,
    context: contextSnapshot,
    secrets,
    runtime,
    signal,
    providers,
    providerValues: config.providers?.[config.refine.provider] || {}
  })
}

function validateConfigShape (config) {
  if (!config || typeof config !== 'object') {
    throw processingError('configuration', 'Processing configuration is missing')
  }
  if (!config.primary?.provider) {
    throw processingError('configuration', 'A primary provider is required')
  }
  if (config.refine?.enabled && !config.refine.provider) {
    throw processingError('configuration', 'A refine provider is required')
  }
}

async function runPrimary ({ primary, primaryTrace, audio, context, runtime, signal }) {
  assertNotCancelled(signal)

  const startedAt = runtime.clock.now()
  const result = await primary.processor.process({
    input: audio,
    context: filterContext(context, primary.capabilities),
    instructions: null,
    signal
  })
  primaryTrace.elapsedMs = runtime.clock.now() - startedAt
  recordTraceMeta(primaryTrace, result)

  requireText(result, 'primary')
  return { text: result.text, trace: [primaryTrace], warning: null }
}

async function runRefine ({
  primary,
  primaryTrace,
  refineConfig,
  audio,
  context,
  secrets,
  runtime,
  signal,
  providers,
  providerValues
}) {
  const primaryResult = await runPrimary({ primary, primaryTrace, audio, context, runtime, signal })
  assertNotCancelled(signal)

  const startedAt = runtime.clock.now()
  let refineTrace = pendingRefineTrace(refineConfig)

  try {
    const refine = createStep({
      providers,
      selection: { provider: refineConfig.provider, values: refineConfig.values },
      providerValues,
      role: 'refine',
      secrets,
      runtime
    })
    refineTrace = traceFor({ resolved: refine, context })
    refineTrace.input = 'text'

    const result = await refine.processor.process({
      input: { kind: 'text', text: primaryResult.text },
      context: filterContext(context, refine.capabilities),
      instructions: refineConfig.instructions || '',
      signal
    })
    refineTrace.elapsedMs = runtime.clock.now() - startedAt
    recordTraceMeta(refineTrace, result)

    requireText(result, 'refine')
    return { text: result.text, trace: [primaryTrace, refineTrace], warning: null }
  } catch (error) {
    if (signal?.aborted) {
      throw processingError('cancelled', 'Processing was cancelled')
    }
    if (refineConfig.onError === 'abort') { throw error }
    return {
      text: primaryResult.text,
      trace: [
        primaryTrace,
        failedTrace(refineTrace, error, runtime.clock.now() - startedAt)
      ],
      warning: {
        type: 'refine-failed',
        provider: refineConfig.provider,
        message: safeMessage(error)
      }
    }
  }
}

function createStep ({ providers, selection, providerValues, role, secrets, runtime }) {
  const resolved = resolveSelection({ providers, selection, providerValues, role, secrets })
  return { ...resolved, processor: createProcessor({ resolved, secrets, runtime }) }
}

// Inspect is the single pure Provider resolution path. Preferences can show
// capabilities and issues even while a selection is incomplete; executable
// callers use resolveSelection(), which turns the first issue into a stable
// configuration error before Processor creation.
export function inspectSelection ({ providers, selection, providerValues = {}, role, secrets = {} }) {
  const providerId = selection?.provider
  const provider = providers.get(providerId)
  if (!provider) {
    return {
      provider: null,
      providerId,
      role,
      config: null,
      capabilities: null,
      issues: [{ message: `Unknown provider: ${String(providerId)}` }]
    }
  }

  const { providerValues: effectiveProviderValues, secretPresence } =
    prepareResolveInput(provider.manifest.fields || [], providerId, providerValues, secrets)
  const resolution = provider.resolve({
    providerValues: effectiveProviderValues,
    values: selection.values || {},
    secretPresence
  })
  const issues = [...(resolution.issues || [])]

  if (resolution.capabilities && !suitableForRole(resolution.capabilities, role)) {
    const purpose = role === 'primary' ? 'primary audio processing' : 'refine'
    issues.push({ message: `Provider ${providerId} selection cannot perform ${purpose}` })
  }

  return {
    provider,
    providerId,
    role,
    config: resolution.config,
    capabilities: resolution.capabilities,
    issues
  }
}

export function resolveSelection (args) {
  const inspected = inspectSelection(args)
  if (inspected.issues.length > 0) {
    const first = inspected.issues[0]
    throw processingError('configuration', typeof first === 'string' ? first : first.message)
  }
  const { issues: _issues, ...resolved } = inspected
  return resolved
}

export function createProcessor ({ resolved, secrets = {}, runtime }) {
  const providerSecrets = collectSecrets(
    resolved.provider.manifest.fields || [],
    resolved.providerId,
    secrets
  )
  return resolved.provider.create(resolved.config, providerSecrets, runtime)
}

export function prepareResolveInput (manifestFields, providerId, providerValues = {}, secrets = {}) {
  return {
    providerValues: resolveProviderValues(providerValues, manifestFields),
    secretPresence: buildSecretPresence(manifestFields, providerId, secrets)
  }
}

function suitableForRole (capabilities, role) {
  const inputs = capabilities?.inputs || []
  return role === 'primary'
    ? inputs.includes('audio')
    : role === 'refine' && inputs.includes('text') && capabilities.instructions
}

function resolveProviderValues (overrides, fields) {
  const values = {}
  for (const field of fields) {
    if (field.type === 'secret') { continue }
    if (overrides[field.key] !== undefined && overrides[field.key] !== null) {
      values[field.key] = overrides[field.key]
    } else if (field.default !== undefined) {
      values[field.key] = field.default
    }
  }
  return values
}

function buildSecretPresence (fields, providerId, secrets) {
  const presence = {}
  for (const field of fields) {
    if (field.type === 'secret') {
      presence[field.key] = Boolean(secrets[secretKey(providerId, field.key)])
    }
  }
  return presence
}

function collectSecrets (fields, providerId, secrets) {
  const collected = {}
  for (const field of fields) {
    if (field.type !== 'secret') { continue }
    const key = secretKey(providerId, field.key)
    if (secrets[key]) { collected[field.key] = secrets[key] }
  }
  return collected
}

export function secretKey (providerId, fieldKey) {
  return `providers/${providerId}/${fieldKey}`
}

export function filterContext (context, capabilities) {
  return capabilities?.context ? context : { text: '' }
}

export function normalizeContext (context) {
  if (!context) { return { text: '' } }
  const value = context.text
  if (value === undefined || value === null) { return { text: '' } }
  if (typeof value !== 'string') {
    throw processingError('configuration', 'Context text must be a string')
  }
  return { text: value.trim() }
}

function traceFor ({ resolved, context }) {
  return {
    role: resolved.role,
    provider: resolved.providerId,
    model: resolved.config?.model ?? null,
    input: 'audio',
    status: 'ok',
    elapsedMs: 0,
    context: contextInUse(context, resolved.capabilities),
    usage: null,
    requestId: null,
    responseId: null
  }
}

function pendingRefineTrace (refineConfig) {
  return {
    role: 'refine',
    provider: refineConfig.provider,
    model: refineConfig.values?.model ?? null,
    input: 'text',
    status: 'ok',
    elapsedMs: 0,
    context: [],
    usage: null,
    requestId: null,
    responseId: null
  }
}

function recordTraceMeta (trace, result) {
  trace.usage = result?.usage ?? null
  trace.requestId = result?.requestId ?? null
  trace.responseId = result?.responseId ?? null
}

function contextInUse (context, capabilities) {
  return capabilities?.context && context.text ? ['text'] : []
}

function failedTrace (trace, error, elapsedMs) {
  return { ...trace, status: 'error', elapsedMs, error: safeMessage(error) }
}

function safeMessage (error) {
  const message = error?.message ?? String(error)
  // Bound Provider-originated diagnostics before they reach History or UI.
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}

function requireText (result, role) {
  const text = result?.text?.trim()
  if (!text) {
    throw processingError('no-text', role === 'primary'
      ? 'No speech was recognized'
      : 'No text returned from refine processing')
  }
  result.text = text
}

function assertNotCancelled (signal) {
  if (signal?.aborted) { throw processingError('cancelled', 'Processing was cancelled') }
}
