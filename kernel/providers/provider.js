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
          `${this.manifest.label} ${field.label.toLowerCase()} is required`
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
          `${this.manifest.label} ${fields[0].label.toLowerCase()} is required`
        ))
      }
    }

    return issues
  }

  resolveSelection () {
    throw new Error(`${this.id}.resolveSelection() is not implemented`)
  }

  create () {
    throw new Error(`${this.id}.create() is not implemented`)
  }
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

function hasValue (value) {
  return typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined
}

function requiredIssue (path, message) {
  return { path, code: 'required', message }
}
