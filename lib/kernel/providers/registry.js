// Provider registration. Static and explicit: adding a Provider means one
// cohesive module plus one entry here; nothing else in the system changes.
//
// Every entry is structurally validated against the Provider contract at
// import time: a malformed Provider fails at startup, never mid-attempt.
//
// This module must not import GNOME/GI libraries.
//
// test-integrated is deliberately NOT registered: it exists only so Kernel
// tests can exercise the integrated-refine branch against a Provider whose
// explicit capability is true. No production Provider advertises integrated
// refine until a dedicated semantic verification passes.

import { qwenProvider } from './qwen.js'
import { mimoProvider } from './mimo.js'
import { openaiProvider, openaiCompatibleProvider } from './openai.js'
import { validateProvider } from '../types.js'

const entries = [
  ['qwen', qwenProvider],
  ['mimo', mimoProvider],
  ['openai', openaiProvider],
  ['openai-compatible', openaiCompatibleProvider]
]

for (const [id, provider] of entries) {
  const issues = validateProvider(provider)
  if (id !== provider.id) {
    issues.push(`${id}: registry id and provider.id must match`)
  }
  if (issues.length > 0) {
    throw new Error(`Invalid provider registration:\n  ${issues.join('\n  ')}`)
  }
}

export const providers = new Map(entries)
