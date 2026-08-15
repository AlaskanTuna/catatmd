import { env } from '../../config/env.js'
import { OpenAICompatibleClient } from './openai-compatible.js'
import type { LLMClient, LLMProvider } from './types.js'

export type { GenerateRequest, LLMClient, LLMProvider } from './types.js'
export { LLMResponseError } from './types.js'

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

function build(): LLMClient {
  switch (env.LLM_PROVIDER) {
    case 'qwen': {
      if (!env.QWEN_API_KEY) throw new Error('QWEN_API_KEY is required when LLM_PROVIDER=qwen')
      return new OpenAICompatibleClient('qwen', env.QWEN_MODEL, {
        apiKey: env.QWEN_API_KEY,
        baseURL: env.QWEN_BASE_URL,
        resolvesSchemaRefs: true,
      })
    }
    case 'gemini': {
      if (!env.GEMINI_API_KEY)
        throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini')
      return new OpenAICompatibleClient('gemini', env.GEMINI_MODEL, {
        apiKey: env.GEMINI_API_KEY,
        baseURL: GEMINI_BASE_URL,
        // The only provider here that will not resolve a `$ref`. Measured
        // 15/08/26 against the live endpoint: the referencing form of
        // `clinical_facts` returns a bodiless HTTP 400, so this pays the full
        // 14,240 B rather than 3,558 B (issue #109). Local dev only, so the
        // cost falls where it matters least.
        resolvesSchemaRefs: false,
      })
    }
    case 'deepseek': {
      if (!env.DEEPSEEK_API_KEY)
        throw new Error('DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek')
      return new OpenAICompatibleClient('deepseek', env.DEEPSEEK_MODEL, {
        apiKey: env.DEEPSEEK_API_KEY,
        baseURL: env.DEEPSEEK_BASE_URL,
        // Deliberately unverified rather than assumed. The 15/08/26 sweep that
        // settled the other two could not reach DeepSeek: the configured key
        // returns 401 on every request, schema-independent. `false` is the
        // form this provider has always been sent, so it keeps behaviour
        // identical until someone with a working key measures it (issue #109).
        resolvesSchemaRefs: false,
      })
    }
  }
}

let cached: LLMClient | undefined

export function getLLMClient(): LLMClient {
  cached ??= build()
  return cached
}

/**
 * Provider and model identity for audit stamps, read from the environment
 * without constructing a client.
 *
 * `getLLMClient()` throws when the matching provider's API key is missing,
 * which is correct at the egress point and wrong everywhere else — an audit
 * write that only wants two strings must not be able to fail, least of all
 * after the analysis it is recording has already been persisted.
 */
export function getLLMDescriptor(): { provider: LLMProvider; model: string } {
  switch (env.LLM_PROVIDER) {
    case 'qwen':
      return { provider: 'qwen', model: env.QWEN_MODEL }
    case 'gemini':
      return { provider: 'gemini', model: env.GEMINI_MODEL }
    case 'deepseek':
      return { provider: 'deepseek', model: env.DEEPSEEK_MODEL }
  }
}
