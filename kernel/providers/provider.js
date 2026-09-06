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

    const seen = new Set()
    for (const field of this.manifest.selectionFields || []) {
      if (!field.required || seen.has(field.key)) { continue }
      if (input && field.inputs && !field.inputs.includes(input)) { continue }
      seen.add(field.key)
      if (!hasValue(values[field.key])) {
        issues.push(requiredIssue(
          `values.${field.key}`,
          `${this.manifest.label} ${field.label.toLowerCase()} is required`
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

function hasValue (value) {
  return typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined
}

function requiredIssue (path, message) {
  return { path, code: 'required', message }
}
