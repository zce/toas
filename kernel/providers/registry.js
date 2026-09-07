import { doubaoProvider } from './doubao.js'
import { mimoProvider } from './mimo.js'
import { openaiCompatibleProvider, openaiProvider } from './openai.js'
import { Provider } from './provider.js'
import { qwenProvider } from './qwen.js'

const registered = [qwenProvider, doubaoProvider, mimoProvider, openaiProvider, openaiCompatibleProvider]

// Static registry: construction-time checks keep a broken Provider
// definition from surfacing as a runtime surprise.
export const providers = new Map()

for (const provider of registered) {
  if (!(provider instanceof Provider)) {
    throw new Error(`Registered Provider must extend Provider: ${provider?.id ?? 'unknown'}`)
  }
  if (providers.has(provider.id)) {
    throw new Error(`Duplicate Provider id: ${provider.id}`)
  }
  providers.set(provider.id, provider)
}
