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
// Capabilities describe one resolved Provider selection, never a Provider or
// product role in the abstract. `undefined` is never a valid value.
//
// inputs:         Processor input kinds accepted by this exact selection.
// instructions:   text input can be transformed by supplied Instructions.
// context:        the Processor consumes Host-supplied free-text Context.
// integratedRefine: one call transforms audio into refined text following
//                 Refine Instructions. Independent of context: a model can
//                 accept bias text without being able to execute a
//                 transformation instruction (verified against
//                 qwen3-asr-flash, which accepts context and ignores
//                 instructions).

/**
 * @typedef {Object} Capability
 * @property {Array<'audio'|'text'>} inputs
 * @property {boolean} instructions
 * @property {boolean} context
 * @property {boolean} integratedRefine
 */

// --- Manifest ------------------------------------------------------------------

/**
 * One editable Provider-level or selection-level value.
 *
 * `choices` is presentation metadata for a finite verified value set. It does
 * not replace Provider.resolve() validation: resolve remains authoritative.
 *
 * @typedef {Object} ManifestField
 * @property {string} key
 * @property {'string'|'url'|'secret'} type
 * @property {string} label
 * @property {boolean} [required]
 * @property {string|number|boolean} [default]
 * @property {Array<'audio'|'text'>} [inputs] input kinds for which this field
 *   applies; omitted means every supported input
 * @property {Array<{value: string, label?: string}>} [choices] finite values
 *   the Preferences UI can present directly instead of accepting free text
 * @property {string[]} [env] environment fallbacks, Provider-level only
 */

/**
 * @typedef {Object} ProviderManifest
 * @property {string} label
 * @property {ManifestField[]} fields shared service configuration and secrets
 * @property {ManifestField[]} selectionFields values resolved independently
 *   for each selected Processor
 * @property {{inputs: Array<'audio'|'text'>, instructions: boolean}} support
 *   static discovery upper bound; resolve() is authoritative
 * @property {Object<string, Object>} [defaults] default selection values by
 *   input kind
 */

// --- Provider ------------------------------------------------------------------

/**
 * A registered service integration.
 *
 * @typedef {Object} Provider
 * @property {string} id
 * @property {ProviderManifest} manifest
 * @property {function(ResolveInput): ResolveOutput} resolve
 * @property {function(Object, Object, Object): Processor} create
 */

/**
 * @typedef {Object} ResolveInput
 * @property {Object} providerValues resolved provider-level values
 * @property {Object} values selected values
 * @property {Object<string, boolean>} secretPresence flat map of secret
 *   field key -> present
 */

/**
 * @typedef {Object} ResolveOutput
 * @property {?Object} config null when issues exist
 * @property {?Capability} capabilities null only when selection semantics
 *   cannot be determined
 * @property {Array<{path: string, code: string, message: string}>} issues
 */

/**
 * The single execution seam. The resolved capabilities declare accepted
 * inputs; Product Roles never enter the Processor interface.
 * @typedef {Object} Processor
 * @property {function(ProcessorInput): Promise<ProcessorResult>} process
 */

/**
 * @typedef {Object} ProcessorInput
 * @property {AudioInput|TextInput} input
 * @property {{text: string}} context capability-filtered
 * @property {?string} instructions
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
      validateField(field, where, push)
      if (field.type === 'secret' && !Array.isArray(field.env)) {
        push(`${where} (secret) must declare its environment fallbacks, even if empty`)
      }
    })
  }

  const selectionFields = provider?.manifest?.selectionFields
  if (!Array.isArray(selectionFields) || selectionFields.length === 0) {
    push('manifest.selectionFields must be a non-empty array')
  } else {
    selectionFields.forEach((field, index) => validateField(field, `manifest.selectionFields[${index}]`, push))
  }

  const support = provider?.manifest?.support
  if (!Array.isArray(support?.inputs) || support.inputs.length === 0 ||
      support.inputs.some(input => input !== 'audio' && input !== 'text')) {
    push('manifest.support.inputs must contain audio and/or text')
  }
  if (typeof support?.instructions !== 'boolean') {
    push('manifest.support.instructions must be an explicit boolean')
  }

  if (typeof provider?.resolve !== 'function') { push('resolve must be a function') }
  if (typeof provider?.create !== 'function') { push('create must be a function') }

  return issues
}

function validateField (field, where, push) {
  if (typeof field?.key !== 'string' || !field.key) { push(`${where}.key must be a non-empty string`) }
  if (!FIELD_TYPES.includes(field?.type)) { push(`${where}.type must be one of ${FIELD_TYPES.join('|')}`) }
  if (field?.inputs !== undefined && (!Array.isArray(field.inputs) ||
      field.inputs.some(input => input !== 'audio' && input !== 'text'))) {
    push(`${where}.inputs must contain only audio and/or text`)
  }
  if (field?.choices !== undefined && (!Array.isArray(field.choices) || field.choices.length === 0 ||
      field.choices.some(choice => typeof choice?.value !== 'string' || !choice.value ||
        (choice.label !== undefined && (typeof choice.label !== 'string' || !choice.label))))) {
    push(`${where}.choices must be a non-empty array of string values with optional labels`)
  }
}
