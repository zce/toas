import { processingError } from '../error.js'

const REFINE_SYSTEM_PROMPT = `Refine the transcript into clear written text.
Follow the user's instructions when provided and use context as helpful reference.
By default, return only the refined text.`

export class Provider {
  constructor ({ id, manifest }) {
    this.id = id
    this.manifest = manifest
  }

  resolve ({ providerValues = {}, values = {}, secretPresence = {} } = {}) {
    const resolved = this.resolveSelection({ providerValues, values })
    const issues = [
      ...this.requiredIssues({
        providerValues,
        values,
        secretPresence,
        input: resolved.input ?? null
      }),
      ...(resolved.issues || [])
    ]

    if (issues.length > 0) {
      return {
        config: null,
        capabilities: resolved.capabilities ?? null,
        issues
      }
    }

    return {
      config: resolved.config,
      capabilities: resolved.capabilities,
      issues: []
    }
  }

  requiredIssues ({
    providerValues = {},
    values = {},
    secretPresence = {},
    input = null
  } = {}) {
    const issues = []

    for (const field of this.manifest.fields || []) {
      if (!field.required) { continue }
      const present = field.type === 'secret'
        ? Boolean(secretPresence[field.key])
        : hasValue(providerValues[field.key])
      if (!present) {
        issues.push(requiredIssue(
          `providers.${this.id}.${field.key}`,
          `${this.manifest.label} ${requirementName(field.label)} is required`
        ))
      }
    }

    const requiredByKey = new Map()
    for (const field of this.manifest.selectionFields || []) {
      if (!field.required) { continue }
      const fields = requiredByKey.get(field.key) ?? []
      fields.push(field)
      requiredByKey.set(field.key, fields)
    }

    for (const [key, fields] of requiredByKey) {
      if (!requiredForInput(fields, input, this.manifest.support?.inputs || [])) { continue }
      if (!hasValue(values[key])) {
        issues.push(requiredIssue(
          `values.${key}`,
          `${this.manifest.label} ${requirementName(fields[0].label)} is required`
        ))
      }
    }

    return issues
  }

  supports (input, { instructions = false } = {}) {
    const support = this.manifest.support
    return Boolean(
      support?.inputs?.includes(input) &&
      (!instructions || support.instructions)
    )
  }

  resolveModelShape (values, shapes) {
    const model = values.model?.trim()
    const shape = model ? shapes[model] ?? null : null
    return {
      model,
      shape,
      issues: model && !shape
        ? [{
            path: 'values.model',
            code: 'unsupported',
            message: `Unsupported ${this.manifest.label} model: ${model}`
          }]
        : []
    }
  }

  create (config, secrets = {}, runtime) {
    for (const field of this.manifest.fields || []) {
      if (field.type !== 'secret' || !field.required || secrets[field.key]) { continue }
      throw processingError(
        'configuration',
        `${this.manifest.label} ${requirementName(field.label)} is required to create a processor`
      )
    }
    return this.createProcessor(config, secrets, runtime)
  }

  // Context is one toas-level reference-text contract. Providers decide only
  // how that reference text maps to a documented native protocol capability.
  contextText (context) {
    return typeof context?.text === 'string' ? context.text : ''
  }

  composeRefinePrompt ({ transcript, context = { text: '' }, instructions = '' }) {
    const sections = []
    const contextText = this.contextText(context)

    if (instructions?.trim()) { sections.push(taggedSection('instructions', instructions)) }
    if (contextText.trim()) { sections.push(taggedSection('context', contextText)) }
    sections.push(taggedSection('transcript', transcript))

    return {
      systemPrompt: REFINE_SYSTEM_PROMPT,
      userPrompt: sections.join('\n\n')
    }
  }

  resolveSelection () {
    throw new Error(`${this.id}.resolveSelection() is not implemented`)
  }

  createProcessor () {
    throw new Error(`${this.id}.createProcessor() is not implemented`)
  }
}

function taggedSection (name, content) {
  return `<${name}>\n${content}\n</${name}>`
}

function requiredForInput (fields, input, supportedInputs) {
  if (input) {
    return fields.some(field => !field.inputs || field.inputs.includes(input))
  }

  if (fields.some(field => !field.inputs)) { return true }
  if (supportedInputs.length === 0) { return false }

  const coveredInputs = new Set(fields.flatMap(field => field.inputs || []))
  return supportedInputs.every(supported => coveredInputs.has(supported))
}

function requirementName (label) {
  const value = String(label ?? '')
  if (/^[A-Z]{2,}(?:\s|$)/.test(value)) { return value }
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : 'value'
}

function hasValue (value) {
  return typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined
}

function requiredIssue (path, message) {
  return { path, code: 'required', message }
}
