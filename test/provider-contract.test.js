// Provider contract tests: the structural validation every registered
// Provider passes at import time, plus the contract invariants the Kernel
// relies on. No network, no GNOME.

import { validateProvider } from '../lib/kernel/types.js'
import { providers as registry } from '../lib/kernel/providers/registry.js'
import { test, expectEqual, expectTruthy, run } from './harness.js'

test('every registered provider passes structural validation', () => {
  for (const [id, provider] of registry) {
    const issues = validateProvider(provider)
    expectEqual(issues, [], `provider ${id} violated the contract`)
    expectEqual(provider.id, id, `registry key and provider.id must match`)
  }
})

test('every role manifest declares both capabilities as explicit booleans', () => {
  for (const [, provider] of registry) {
    for (const roleKey of ['primary', 'refine']) {
      const role = provider.manifest[roleKey]
      if (role === undefined) { continue }

      for (const name of ['context', 'integratedRefine']) {
        const value = role.capabilities?.[name]
        expectEqual(typeof value, 'boolean',
          `${provider.id}.${roleKey}.capabilities.${name} must be an explicit boolean`)
      }
    }
  }
})

test('context does not imply integrated refine: the capability axes are independent', () => {
  // The live counterexample: qwen3-asr-flash accepts bias text and ignores
  // transformation instructions. A Provider declaring both must declare
  // both; the contract never derives one from the other.
  const qwen = registry.get('qwen')
  const caps = qwen.manifest.primary.capabilities
  expectEqual(caps.context, true)
  expectEqual(caps.integratedRefine, false)
})

test('providers serving refine roles declare them in the manifest', () => {
  // OpenAI is refine-only: no primary role manifest at all.
  expectEqual(registry.get('openai').manifest.primary, undefined)
  expectTruthy(registry.get('openai').manifest.refine)

  // Qwen is primary-only: no refine role manifest at all.
  expectEqual(registry.get('qwen').manifest.refine, undefined)
  expectTruthy(registry.get('qwen').manifest.primary)
})

test('validation rejects omitted capabilities, bad field types, and missing functions', () => {
  const base = () => ({
    id: 'broken',
    manifest: {
      label: 'Broken',
      fields: [
        { key: 'endpoint', type: 'url', label: 'Endpoint', required: true },
        { key: 'key', type: 'secret', label: 'API key', required: true, env: [] }
      ],
      primary: {
        fields: [{ key: 'model', type: 'string', label: 'Model', required: true }],
        capabilities: { context: true, integratedRefine: false }
      }
    },
    resolve: () => {},
    create: () => {}
  })

  // Well-formed base passes.
  expectEqual(validateProvider(base()), [])

  // Omitted integratedRefine (the undefined-is-not-a-value rule).
  const omitted = base()
  omitted.manifest.primary.capabilities = { context: true }
  expectTruthy(validateProvider(omitted).length > 0)

  // Non-boolean context.
  const numeric = base()
  numeric.manifest.primary.capabilities = { context: 1, integratedRefine: false }
  expectTruthy(validateProvider(numeric).length > 0)

  // Unknown field type.
  const badType = base()
  badType.manifest.primary.fields[0].type = 'magic'
  expectTruthy(validateProvider(badType).length > 0)

  // Secret field without env declaration.
  const noEnv = base()
  delete noEnv.manifest.fields[1].env
  expectTruthy(validateProvider(noEnv).length > 0)

  // Missing create().
  const noCreate = base()
  delete noCreate.create
  expectTruthy(validateProvider(noCreate).length > 0)

  // Missing primary role manifest.
  const noPrimary = base()
  delete noPrimary.manifest.primary
  expectTruthy(validateProvider(noPrimary).length > 0)
})

run()