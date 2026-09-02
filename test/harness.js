// Minimal standalone GJS test harness. Each test file registers tests and
// calls run() at the end; exit code reflects failures.
import System from 'system'

const tests = []

export function test (name, fn) {
  tests.push({ name, fn })
}

export function expectEqual (actual, expected, message = '') {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(
            `${message || 'expectEqual failed'}\n  expected: ${expectedJson}\n  actual:   ${actualJson}\n  at: ${new Error().stack?.split('\n')[2]?.trim() ?? ''}`
    )
  }
}

export function expectTruthy (value, message = '') {
  if (!value) {
    throw new Error(
            `${message}\n  expected truthy, got: ${JSON.stringify(value)}`
    )
  }
}

export function expectThrowsAsync (fn, messagePart, message = '') {
  return (async () => {
    try {
      await fn()
    } catch (error) {
      if (messagePart && !String(error?.message ?? error).includes(messagePart)) {
        throw new Error(
                    `${message}\n  error did not mention "${messagePart}": ${error?.message ?? error}`
        )
      }
      return
    }
    throw new Error(`${message}\n  expected rejection, resolved instead`)
  })()
}

export async function run () {
  let failed = 0
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`ok - ${name}`)
    } catch (error) {
      failed++
      console.error(`FAIL - ${name}`)
      console.error(`    ${error?.message ?? error}`)
      if (error?.stack) { console.error(`    ${error.stack.split('\n').slice(1, 4).join('\n')}`) }
    }
  }

  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  System.exit(failed > 0 ? 1 : 0)
}