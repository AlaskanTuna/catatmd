import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  LLM_PROVIDER: z.enum(['qwen', 'gemini', 'deepseek']).default('qwen'),

  QWEN_API_KEY: z.string().optional(),
  QWEN_BASE_URL: z.string().url().default('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  QWEN_MODEL: z.string().default('qwen3.7-flash'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-flash'),

  DEID_FAIL_CLOSED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:', z.prettifyError(parsed.error))
  process.exit(1)
}

export const env = parsed.data

if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'gemini') {
  throw new Error(
    'LLM_PROVIDER=gemini is local-dev-only. The free tier permits Google to use ' +
      'submitted content for product improvement and human review; it must never ' +
      'sit on a path that could carry patient-derived text.',
  )
}

if (env.NODE_ENV === 'production' && !env.DEID_FAIL_CLOSED) {
  throw new Error('DEID_FAIL_CLOSED must be true in production.')
}
