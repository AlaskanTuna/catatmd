import { env } from '../../config/env.js'
import { OpenAICompatibleClient } from './openai-compatible.js'
import type { LLMClient } from './types.js'

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
      })
    }
    case 'gemini': {
      if (!env.GEMINI_API_KEY)
        throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini')
      return new OpenAICompatibleClient('gemini', env.GEMINI_MODEL, {
        apiKey: env.GEMINI_API_KEY,
        baseURL: GEMINI_BASE_URL,
      })
    }
    case 'deepseek': {
      if (!env.DEEPSEEK_API_KEY)
        throw new Error('DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek')
      return new OpenAICompatibleClient('deepseek', env.DEEPSEEK_MODEL, {
        apiKey: env.DEEPSEEK_API_KEY,
        baseURL: env.DEEPSEEK_BASE_URL,
      })
    }
  }
}

let cached: LLMClient | undefined

export function getLLMClient(): LLMClient {
  cached ??= build()
  return cached
}
