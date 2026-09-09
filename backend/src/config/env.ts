import { resolve } from 'node:path'
import { LiveAsrRegionSchema } from '@shared/types'
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

  // Edge addresses whose forwarded client address may be believed (#156).
  // Comma-separated, and empty by default: an unset value means every caller is
  // keyed by the address Cloudflare observed, which is the behaviour that
  // predates the Vercel rewrite. See middleware/client-ip.ts for why an
  // allow-list is the only safe way to read `x-forwarded-for` here.
  TRUSTED_PROXY_IPS: z.string().default(''),

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
  QWEN_MODEL: z.string().default('qwen3.7-flash'),
  // Retrieval embeddings share the Qwen key and Singapore endpoint (#220).
  QWEN_EMBEDDING_MODEL: z.string().default('text-embedding-v4'),

  // Supabase Storage for the downloaded CPG PDFs (#220). Optional: ingestion
  // still indexes text without them and simply skips the upload.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_GUIDELINES_BUCKET: z.string().default('guidelines'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4-flash'),

  // Hosted-ASR relay (#154). Optional: an absent key disables the relay at
  // request time (503 asr_unavailable) rather than failing boot, so a
  // deployment without hosted transcription simply omits it.
  ILMU_API_KEY: z.string().optional(),
  ILMU_BASE_URL: z.string().url().default('https://api.ilmu.ai/v1'),
  ILMU_ASR_MODEL: z.string().default('ilmu-asr-v4.2'),

  // Soniox real-time ASR, which carries ambient capture (#268). Optional on the
  // same terms as ILMU: an absent key disables the mint route at request time
  // (503 asr_unavailable) rather than failing boot.
  //
  // The region is an enum, not a URL: hostnames are literals in
  // lib/asr/soniox.ts, because the socket address travels to the browser and a
  // hostname assembled from free text is one typo away from the wrong country.
  // It must name the region of the Soniox project the key belongs to, which
  // that vendor fixes at project creation; a mismatch fails the mint closed.
  // Changing it means changing the CSP connect-src host in vercel.json too.
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_REGION: LiveAsrRegionSchema.default('us'),
  SONIOX_RT_MODEL: z.string().default('stt-rt-v5'),

  // How long a consultation recording is kept so the doctor can check what the
  // recogniser wrote (#293).
  //
  // **Deliberately without a default, and the feature is off while it is
  // unset.** security.md forbids inventing a retention period: the clinic data
  // controller adopts one, and substituting a number here would turn a decision
  // nobody made into the behaviour of the system. Absent means no recording is
  // ever stored, which is the safe direction to fail for the one kind of PHI
  // that cannot be de-identified.
  //
  // No upper bound is imposed for the same reason. The number is the
  // controller's to choose; .env.example carries the market comparison rather
  // than a rule.
  AUDIO_RETENTION_HOURS: z.coerce.number().int().positive().optional(),

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
