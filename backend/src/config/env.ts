import { resolve } from 'node:path'
import { config } from 'dotenv'
import { z } from 'zod'

// Resolved from this module, not the working directory: the backend is started
// with cwd=backend/ but .env lives at the repo root, shared with Prisma. Three
// levels up lands on the root from both src/config/ and the built dist/config/.
// No-ops in production, where the platform supplies the variables.
config({ path: resolve(import.meta.dirname, '../../../.env') })

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // Shared demo account behind "Sign in as guest" (#29). Optional: absent
  // credentials disable the guest route rather than failing boot, so a
  // deployment that does not want a public demo simply omits them.
  GUEST_EMAIL: z.string().email().optional(),
  GUEST_PASSWORD: z.string().min(8).optional(),

  // Password for the two seeded demo doctors. Consumed by prisma/seed.ts only;
  // absent in normal runtime, which is why it is optional.
  SEED_DOCTOR_PASSWORD: z.string().min(8).optional(),

  LLM_PROVIDER: z.enum(['qwen', 'gemini', 'deepseek']).default('qwen'),

  QWEN_API_KEY: z.string().optional(),
  QWEN_BASE_URL: z.string().url().default('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  QWEN_MODEL: z.string().default('qwen-flash'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-flash'),

  // Verbosity only. No level widens what may be written: redaction in
  // lib/logger.ts is unconditional, so there is no debug flag that unlocks raw
  // content (GitHub issue #15, non-goals).
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

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

if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'deepseek') {
  throw new Error(
    'LLM_PROVIDER=deepseek is benchmarking-only. The hosted API processes and ' +
      'stores data in the PRC, which raises an unresolved PDPA 2010 s.129 ' +
      'cross-border transfer question; it must never sit on a path that could ' +
      'carry patient-derived text.',
  )
}

if (env.NODE_ENV === 'production' && !env.DEID_FAIL_CLOSED) {
  throw new Error('DEID_FAIL_CLOSED must be true in production.')
}
