// Provider registration. Static and explicit: adding a Provider means one
// cohesive module plus one entry here; nothing else in the system changes.
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

export const providers = new Map([
  ['qwen', qwenProvider],
  ['mimo', mimoProvider],
  ['openai', openaiProvider],
  ['openai-compatible', openaiCompatibleProvider]
])
