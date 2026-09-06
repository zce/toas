export class Provider {
  constructor ({ id, manifest }) {
    this.id = id
    this.manifest = manifest
  }

  requiredIssues ({ providerValues = {}, values = {}, secretPresence = {} } = {}) {
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

  resolve () {
    throw new Error(`${this.id}.resolve() is not implemented`)
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
