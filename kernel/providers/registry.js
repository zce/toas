import { Provider } from './provider.js'
import { qwenProvider } from './qwen.js'
import { mimoProvider } from './mimo.js'
import { openaiProvider, openaiCompatibleProvider } from './openai.js'

const registered = [
  qwenProvider,
  mimoProvider,
  openaiProvider,
  openaiCompatibleProvider
]

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
