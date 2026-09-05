// Runtime-agnostic processing kernel.
//
// Contract (ADR 0001, spec #22 with review amendments):
// - One primary audio-to-text Step, optionally followed by one separate
//   Refine text-to-text Step, or one integrated primary Step carrying
//   Refine Instructions.
// - Config is validated and Providers are resolved before any I/O.
// - Context is attempt input: the Host supplies one immutable free-text
//   snapshot and a Processor receives it only if its capabilities allow.
// - Result carries final text, one Trace entry per physical Processor call,
//   and a nullable warning. Cancellation never degrades into a fallback or a
//   user-facing Provider failure.

// `providers` is optional: the Host passes its registry (identical to the
// static one) so tests and future Hosts can exercise the Kernel without
// monkey-patching module state.
export async function process ({ config, audio, context, secrets, runtime, signal, providers: injectedProviders = null }) {
  if (signal?.aborted) {
    throw processingError('cancelled', 'Processing was cancelled')
  }

  validateConfigShape(config)

  const { providers: registered } = await import('./providers/registry.js')
  const providers = injectedProviders ?? registered

  // Resolve the primary role fully before any I/O: an invalid primary
  // configuration must fail with zero Processor calls.
  const primary = resolveStep({
    providers,
    roleConfig: config.primary,
    role: 'processing',
    secrets,
    runtime
  })
  const primaryTrace = traceFor({
    resolved: primary,
    providerId: config.primary.provider,
    context
  })

  if (!config.refine.enabled) {
    return await runPrimary({ primary, primaryTrace, audio, context, runtime, signal })
  }

  if (config.refine.execution === 'integrated') {
    return await runIntegrated({
      primary,
      primaryTrace,
      refineConfig: config.refine,
      audio,
      context,
      runtime,
      signal
    })
  }

  return await runSeparate({
    primary,
    primaryTrace,
    refineConfig: config.refine,
    audio,
    context,
    secrets,
    runtime,
    signal,
    providers
  })
}

// Validates the logical product shape before resolution. Field-level issues
// surface later from Provider.resolve with stable paths.
function validateConfigShape (config) {
  if (!config || typeof config !== 'object') {
    throw processingError('configuration', 'Processing configuration is missing')
  }
  if (!config.primary?.provider) {
    throw processingError('configuration', 'A primary provider is required')
  }

  const refine = config.refine
  if (refine?.enabled) {
    if (refine.execution !== 'separate' && refine.execution !== 'integrated') {
      throw processingError('configuration', `Unknown refine execution: ${String(refine.execution)}`)
    }
    if (refine.execution === 'separate' && !refine.provider) {
      throw processingError('configuration', 'A refine provider is required for separate refine')
    }
    if (refine.execution === 'integrated' && !refine.instructions?.trim()) {
      throw processingError('configuration', 'Refine instructions are required')
    }
  }
}

// --- Primary-only -----------------------------------------------------------

async function runPrimary ({ primary, primaryTrace, audio, context, runtime, signal }) {
  assertNotCancelled(signal)

  const startedAt = runtime.clock.now()
  const result = await primary.processor.process({
    input: audio,
    context: filterContext(context, primary.resolved.capabilities),
    instructions: null,
    signal
  })
  primaryTrace.elapsedMs = runtime.clock.now() - startedAt
  recordTraceMeta(primaryTrace, result)

  requireText(result, 'processing')
  primaryTrace.text = result.text

  return { text: result.text, trace: [primaryTrace], warning: null }
}

// --- Integrated Refine: exactly one Processor call --------------------------

async function runIntegrated ({ primary, primaryTrace, refineConfig, audio, context, runtime, signal }) {
  // The capability check happens before any Processor call: an unsupported
  // integrated configuration must fail without contacting the Provider.
  if (!primary.resolved.capabilities.integratedRefine) {
    throw processingError(
      'configuration',
      `Provider ${primary.providerId} does not support integrated refine`
    )
  }

  assertNotCancelled(signal)

  // No Refine Processor is created and no second call is made.
  primaryTrace.input = 'audio+instructions'
  primaryTrace.integratedRefine = true

  const startedAt = runtime.clock.now()
  const result = await primary.processor.process({
    input: audio,
    context: filterContext(context, primary.resolved.capabilities),
    instructions: refineConfig.instructions,
    signal
  })
  primaryTrace.elapsedMs = runtime.clock.now() - startedAt
  recordTraceMeta(primaryTrace, result)

  requireText(result, 'processing')
  primaryTrace.text = result.text

  return { text: result.text, trace: [primaryTrace], warning: null }
}

// --- Separate Refine: primary Step then Refine Step --------------------------

async function runSeparate ({ primary, primaryTrace, refineConfig, audio, context, secrets, runtime, signal, providers }) {
  const primaryResult = await runPrimary({ primary, primaryTrace, audio, context, runtime, signal })
  assertNotCancelled(signal)

  // The configured Refine Provider is authoritative; it is resolved and
  // called even when the primary supports integrated refine.
  const refine = resolveStep({
    providers,
    roleConfig: {
      provider: refineConfig.provider,
      endpoint: refineConfig.endpoint ?? null,
      values: refineConfig.values
    },
    role: 'refine',
    secrets,
    runtime
  })
  const refineTrace = traceFor({
    resolved: refine,
    providerId: refineConfig.provider,
    context
  })
  refineTrace.input = 'text'

  const startedAt = runtime.clock.now()
  try {
    const result = await refine.processor.process({
      input: { kind: 'text', text: primaryResult.text },
      context: filterContext(context, refine.resolved.capabilities),
      instructions: refineConfig.instructions || '',
      signal
    })
    refineTrace.elapsedMs = runtime.clock.now() - startedAt
    recordTraceMeta(refineTrace, result)

    requireText(result, 'refine')
    refineTrace.text = result.text

    return {
      text: result.text,
      trace: [primaryTrace, refineTrace],
      warning: null
    }
  } catch (err) {
    // Cancellation always fails the attempt; it is never converted into a
    // fallback warning or a user-facing Provider failure.
    if (signal?.aborted) {
      throw processingError('cancelled', 'Processing was cancelled')
    }
    if (refineConfig.onError === 'abort') {
      throw err
    }
    return {
      text: primaryResult.text,
      trace: [primaryTrace, failedTrace(refineTrace, err, runtime.clock.now() - startedAt)],
      warning: {
        type: 'refine-failed',
        provider: refineConfig.provider,
        message: safeMessage(err)
      }
    }
  }
}

// --- Resolution -------------------------------------------------------------

// Resolves one role against its Provider and returns the created Processor.
// Throws a configuration error with the first field-addressed issue before
// any Processor is created. `create()` performs no I/O.
function resolveStep ({ providers, roleConfig, role, secrets, runtime }) {
  const providerId = roleConfig?.provider
  const provider = providers.get(providerId)

  if (!provider) {
    throw processingError('configuration', `Unknown provider: ${String(providerId)}`)
  }

  const providerValues = resolveProviderValues(
    { endpoint: roleConfig.endpoint },
    provider.manifest.fields || [],
    secrets
  )
  const secretPresence = buildSecretPresence(
    provider.manifest.fields || [],
    providerId,
    secrets
  )

  const resolved = provider.resolve({
    role,
    providerValues,
    values: roleConfig.values || {},
    secretPresence
  })

  if (resolved.issues?.length > 0) {
    const first = resolved.issues[0]
    const detail = typeof first === 'string' ? first : first.message
    throw processingError('configuration', detail)
  }

  const providerSecrets = collectSecrets(
    provider.manifest.fields || [],
    providerId,
    secrets
  )

  const processor = provider.create(role, resolved.config, providerSecrets, runtime)

  return { provider, providerId, role, resolved, processor }
}

function resolveProviderValues (overrides, fields, secrets) {
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

// Presence is a flat map of secret field key -> boolean; Kernel and Providers
// agree on this single shape (spec #22 section 5).
function buildSecretPresence (fields, providerId, secrets) {
  const presence = {}

  for (const field of fields) {
    if (field.type !== 'secret') { continue }

    presence[field.key] = Boolean(secrets[secretKey(providerId, field.key)])
  }

  return presence
}

function collectSecrets (fields, providerId, secrets) {
  const collected = {}

  for (const field of fields) {
    if (field.type !== 'secret') { continue }

    const key = secretKey(providerId, field.key)
    if (secrets[key]) {
      collected[field.key] = secrets[key]
    }
  }

  return collected
}

export function secretKey (providerId, fieldKey) {
  return `providers/${providerId}/${fieldKey}`
}

// --- Context ----------------------------------------------------------------

// Capability filtering: a Processor receives the Context text only when its
// resolved role supports it; otherwise the Processor sees empty Context.
export function filterContext (context, capabilities) {
  const snapshot = normalizeContext(context)
  const filtered = { text: '' }

  if (capabilities?.context) {
    filtered.text = snapshot.text
  }

  return filtered
}

// The Context is one free-text string: the user decides what belongs in it
// (terms, background, names, any bias text). Empty text is valid; a
// non-string value rejects the snapshot before Provider creation and I/O.
export function normalizeContext (context) {
  if (!context) { return { text: '' } }

  const value = context.text

  if (value === undefined || value === null) { return { text: '' } }
  if (typeof value !== 'string') {
    throw processingError('configuration', 'Context text must be a string')
  }

  return { text: value.trim() }
}

// --- Trace ------------------------------------------------------------------

function traceFor ({ resolved, providerId, context }) {
  return {
    role: resolved.role,
    provider: providerId,
    model: resolved.resolved?.config?.model ?? null,
    input: 'audio',
    text: null,
    status: 'ok',
    elapsedMs: 0,
    context: contextFormsInUse(context, resolved.resolved?.capabilities),
    integratedRefine: false,
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

// Records only the form names actually delivered, not Context contents.
function contextFormsInUse (context, capabilities) {
  const snapshot = normalizeContext(context)
  const forms = []
  if (capabilities?.context && snapshot.text) {
    forms.push('text')
  }
  return forms
}

function failedTrace (trace, err, elapsedMs) {
  return {
    ...trace,
    status: 'error',
    elapsedMs,
    error: safeMessage(err)
  }
}

// --- Errors -----------------------------------------------------------------

export const ERROR_CATEGORIES = [
  'configuration',
  'authentication',
  'rate-limited',
  'timeout',
  'network',
  'service',
  'invalid-response',
  'no-text',
  'cancelled',
  'unknown'
]

export function processingError (category, message, status = null) {
  const err = new Error(message)
  err.category = category
  if (status !== null) { err.status = status }
  return err
}

function safeMessage (err) {
  const message = err?.message ?? String(err)
  // Messages come from our own safe constructors; still bound them so a rogue
  // Provider payload cannot flood history or notifications.
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}

function requireText (result, role) {
  const text = result?.text?.trim()
  if (!text) {
    throw processingError('no-text', role === 'processing'
      ? 'No speech was recognized'
      : 'No text returned from refine processing')
  }
  result.text = text
}

function assertNotCancelled (signal) {
  if (signal?.aborted) {
    throw processingError('cancelled', 'Processing was cancelled')
  }
}
