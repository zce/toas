// Provider contract definitions and runtime shape validation.
//
// GJS has no TypeScript. This module gives the Kernel's core seam an
// explicit, checkable contract:
//
//   1. JSDoc typedefs document the exact shape every Provider must expose.
//   2. validateProvider() enforces the structural parts at registration
//      time, so a malformed Provider fails loudly at startup instead of
//      producing a mid-attempt TypeError or, worse, silent misbehavior.
//
// This module must not import GNOME/GI libraries.

// --- Capability ----------------------------------------------------------------
//
// Capabilities are explicit booleans. `undefined` is never a valid value:
// a capability the Provider does not have must be declared `false`. Falsy
// shorthand (omitting the key) hides information and makes "untested" and
// "impossible" indistinguishable.
//
// context:        the Processor consumes Host-supplied free-text Context
//                 (recognition bias / reference material). Declared per
//                 role: a service may accept it for refine but not ASR.
// integratedRefine: one call transforms audio into refined text following
//                 Refine Instructions. Independent of context: a model can
//                 accept bias text without being able to execute a
//                 transformation instruction (verified against
//                 qwen3-asr-flash, which accepts context and ignores
//                 instructions).

/**
 * @typedef {Object} Capability
 * @property {boolean} context
 * @property {boolean} integratedRefine
 */

// --- Manifest ------------------------------------------------------------------

/**
 * One editable value for a provider-level or role-level field.
 *
 * @typedef {Object} ManifestField
 * @property {string} key
 * @property {'string'|'url'|'secret'} type
 * @property {string} label
 * @property {boolean} [required]
 * @property {string|number|boolean} [default]
 * @property {string[]} [env] environment fallbacks, provider-level only
 */

/**
 * Role configuration: fields and capability declaration.
 *
 * @typedef {Object} RoleManifest
 * @property {ManifestField[]} fields
 * @property {Capability} capabilities
 * @property {string} [protocol] internal protocol shape discriminator for
 *   Providers serving multiple wire dialects; never a user-facing concept.
 */

/**
 * @typedef {Object} ProviderManifest
 * @property {string} label
 * @property {ManifestField[]} fields provider-level: service identity
 *   shared by every role of the same service
 * @property {RoleManifest} primary required
 * @property {RoleManifest} [refine] absent when the service offers no
 *   verified refine mapping
 */

// --- Provider ------------------------------------------------------------------

/**
 * A registered service integration.
 *
 * @typedef {Object} Provider
 * @property {string} id
 * @property {ProviderManifest} manifest
 * @property {function(ResolveInput): ResolveOutput} resolve
 * @property {function(string, Object, Object, Object): Processor} create
 */

/**
 * @typedef {Object} ResolveInput
 * @property {'primary'|'refine'} role
 * @property {Object} providerValues resolved provider-level values
 * @property {Object} values role-level values
 * @property {Object<string, boolean>} secretPresence flat map of secret
 *   field key -> present
 */

/**
 * @typedef {Object} ResolveOutput
 * @property {?Object} config null when issues exist
 * @property {?Capability} capabilities null when issues exist
 * @property {Array<{path: string, code: string, message: string}>} issues
 */

/**
 * The single execution seam. role decides the input shape:
 * - primary: {@link AudioInput}
 * - refine: {@link TextInput} plus instructions
 *
 * @typedef {Object} Processor
 * @property {function(ProcessorInput): Promise<ProcessorResult>} process
 */

/**
 * @typedef {Object} ProcessorInput
 * @property {AudioInput|TextInput} input
 * @property {{text: string}} context capability-filtered; empty when the
 *   role has no context capability
 * @property {?string} instructions non-empty only for integrated refine
 * @property {?AttemptSignal} signal
 */

/**
 * @typedef {Object} AudioInput
 * @property {'audio'} kind
 * @property {string} base64
 * @property {string} mimeType
 * @property {number} durationMs
 */

/**
 * @typedef {Object} TextInput
 * @property {'text'} kind
 * @property {string} text
 */

/**
 * @typedef {Object} ProcessorResult
 * @property {string} text
 * @property {?string} model
 * @property {?string} finishReason
 * @property {?Object} usage nullable, normalized token counts
 * @property {?string} requestId
 * @property {?string} responseId
 */

// --- Validation ----------------------------------------------------------------

const FIELD_TYPES = ['string', 'url', 'secret']

// Structural validation of a Provider against the contract. Returns an
// array of violation messages; empty means the Provider is well-formed.
// Semantic checks (a capability the protocol cannot honor) stay in the
// Provider's own tests.
export function validateProvider (provider) {
  const issues = []
  const id = provider?.id ?? '<missing id>'
  const push = (message) => issues.push(`${id}: ${message}`)

  if (typeof provider?.id !== 'string' || !provider.id) { push('id must be a non-empty string') }
  if (typeof provider?.manifest?.label !== 'string' || !provider.manifest.label) {
    push('manifest.label must be a non-empty string')
  }

  const fields = provider?.manifest?.fields
  if (!Array.isArray(fields) || fields.length === 0) {
    push('manifest.fields must be a non-empty array (provider-level identity: endpoint, key, …)')
  } else {
    fields.forEach((field, index) => {
      const where = `manifest.fields[${index}]`
      if (typeof field?.key !== 'string' || !field.key) { push(`${where}.key must be a non-empty string`) }
      if (!FIELD_TYPES.includes(field.type)) { push(`${where}.type must be one of ${FIELD_TYPES.join('|')}`) }
      if (field.type === 'secret' && !Array.isArray(field.env)) {
        push(`${where} (secret) must declare its environment fallbacks, even if empty`)
      }
    })
  }

  // A Provider serves one or both roles; at least one must be present.
  // Serving neither is a registration mistake.
  const primary = provider?.manifest?.primary
  const refine = provider?.manifest?.refine
  if (primary !== undefined && !isRoleManifest(primary)) {
    push('manifest.primary, when present, must be a role manifest')
  } else if (primary !== undefined) {
    validateRoleManifest(primary, 'primary', push)
  }
  if (refine !== undefined && !isRoleManifest(refine)) {
    push('manifest.refine, when present, must be a role manifest')
  } else if (refine !== undefined) {
    validateRoleManifest(refine, 'refine', push)
  }
  if (primary === undefined && refine === undefined) {
    push('manifest must declare at least one role (primary and/or refine)')
  }

  if (typeof provider?.resolve !== 'function') { push('resolve must be a function') }
  if (typeof provider?.create !== 'function') { push('create must be a function') }

  return issues
}

function isRoleManifest (value) {
  return Boolean(value) && Array.isArray(value.fields) && Boolean(value.capabilities)
}

function validateRoleManifest (role, roleKey, push) {
  role.fields.forEach((field, index) => {
    const where = `manifest.${roleKey}.fields[${index}]`
    if (typeof field?.key !== 'string' || !field.key) { push(`${where}.key must be a non-empty string`) }
    if (!FIELD_TYPES.includes(field.type)) { push(`${where}.type must be one of ${FIELD_TYPES.join('|')}`) }
  })

  const capabilities = role.capabilities
  for (const name of ['context', 'integratedRefine']) {
    if (typeof capabilities?.[name] !== 'boolean') {
      push(`manifest.${roleKey}.capabilities.${name} must be an explicit boolean (declared false, not omitted)`)
    }
  }
}