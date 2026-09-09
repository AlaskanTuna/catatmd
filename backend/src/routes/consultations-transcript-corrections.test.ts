import type { Server } from 'node:http'
import { TranscriptCorrectionsResponseSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for the mishear proposal surface (#308).
 *
 * Four properties carry this route, and each has a test below that fails if it
 * is lost: it **proposes without repairing**, it is **draft-only**, it is not an
 * **existence oracle**, and its audit row carries a count and never the words.
 */
const testEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  PORT: 3001,
  CORS_ORIGIN: 'http://localhost:5173',
  TRUSTED_PROXY_IPS: '',
  DATABASE_URL: 'postgresql://unused',
  DIRECT_URL: 'postgresql://unused',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3001',
  GUEST_EMAIL: undefined as string | undefined,
  GUEST_PASSWORD: undefined as string | undefined,
  SEED_DOCTOR_PASSWORD: undefined as string | undefined,
  LLM_PROVIDER: 'qwen',
  QWEN_API_KEY: undefined as string | undefined,
  QWEN_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  QWEN_MODEL: 'qwen3.7-flash',
  GEMINI_API_KEY: undefined as string | undefined,
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  DEEPSEEK_API_KEY: undefined as string | undefined,
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  ILMU_API_KEY: 'test-key' as string | undefined,
  ILMU_BASE_URL: 'https://ilmu.test/v1',
  ILMU_ASR_MODEL: 'ilmu-asr-v4.2',
  SONIOX_API_KEY: 'test-soniox-key' as string | undefined,
  SONIOX_REGION: 'us' as 'us' | 'eu' | 'jp' | 'in',
  SONIOX_RT_MODEL: 'stt-rt-v5',
  LOG_LEVEL: 'info',
  DEID_FAIL_CLOSED: true,
}))

vi.mock('../config/env.js', () => ({ env: testEnv }))

const sessionState = vi.hoisted(() => ({ doctorId: 'doctor-1' as string | undefined }))

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    if (sessionState.doctorId) req.doctorId = sessionState.doctorId
    next()
  },
}))

const RECORDED = {
  source: 'asr_live',
  turns: [
    { speaker: 'doctor', text: 'Ada apa hari ini?' },
    { speaker: 'patient', text: 'Saya ada teman dua hari.' },
  ],
}

const db = vi.hoisted(() => ({
  owner: 'doctor-1' as string,
  status: 'draft' as string,
  transcript: null as unknown,
  auditWrites: [] as { data: Record<string, unknown> }[],
  consultationUpdates: [] as unknown[],
}))

vi.mock('../lib/prisma.js', () => {
  const auditEvent = {
    create: async (args: { data: Record<string, unknown> }) => {
      db.auditWrites.push(args)
      return args.data
    },
    findFirst: async () => {
      const head = db.auditWrites.at(-1)
      return head === undefined ? null : { hash: head.data.hash }
    },
    findMany: async () => [],
  }
  const consultation = {
    findFirst: async ({ where }: { where: { id: string; doctorId: string } }) =>
      where.doctorId === db.owner
        ? {
            id: where.id,
            doctorId: db.owner,
            status: db.status,
            erasedAt: null,
            transcript: db.transcript,
          }
        : null,
    findUnique: async () => null,
    findMany: async () => [],
    create: async ({ data }: { data: unknown }) => data,
    update: async ({ data }: { data: unknown }) => {
      db.consultationUpdates.push(data)
      return data
    },
    updateMany: async () => ({ count: 0 }),
    count: async () => 0,
  }
  const model = {
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
    create: async ({ data }: { data: unknown }) => data,
    update: async ({ data }: { data: unknown }) => data,
    updateMany: async () => ({ count: 0 }),
    upsert: async ({ create }: { create: unknown }) => create,
    delete: async () => null,
    deleteMany: async () => ({ count: 0 }),
    count: async () => 0,
  }

  return {
    prisma: new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'auditEvent') return auditEvent
          if (property === 'consultation') return consultation
          if (property === '$transaction')
            return async (run: (tx: { auditEvent: typeof auditEvent }) => unknown) =>
              run({ auditEvent })
          return typeof property === 'string' && property.startsWith('$')
            ? async () => undefined
            : model
        },
      },
    ),
  }
})

const realFetch = globalThis.fetch
const upstream = vi.fn<typeof fetch>()

let server: Server
let origin: string

beforeAll(async () => {
  vi.stubGlobal('fetch', upstream)
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  sessionState.doctorId = 'doctor-1'
  db.owner = 'doctor-1'
  db.status = 'draft'
  db.transcript = structuredClone(RECORDED)
  db.auditWrites.length = 0
  db.consultationUpdates.length = 0
  upstream.mockReset()
})

const post = async (id = 'consultation-1') =>
  realFetch(`${origin}/api/consultations/${id}/transcript-corrections`, { method: 'POST' })

const auditActions = () => db.auditWrites.map((write) => write.data.action)

describe('POST /api/consultations/:id/transcript-corrections', () => {
  it('proposes the measured correction with both words', async () => {
    const response = await post()
    expect(response.status).toBe(200)

    const parsed = TranscriptCorrectionsResponseSchema.safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.proposals).toEqual([
      { turnIndex: 1, start: 9, original: 'teman', suggested: 'demam' },
    ])
  })

  it('repairs nothing: the stored transcript is untouched', async () => {
    await post()
    // The route proposes. Accepting is the client's own PATCH, so this handler
    // must never write, and a repaired transcript here would be a rewrite of
    // the record the doctor never approved.
    expect(db.consultationUpdates).toHaveLength(0)
    expect(db.transcript).toEqual(RECORDED)
  })

  it('reaches no provider', async () => {
    await post()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('records a count and never the words', async () => {
    await post()

    expect(auditActions()).toEqual(['consultation.corrections_proposed'])
    const metadata = db.auditWrites[0]?.data.metadata
    expect(metadata).toEqual({ proposalCount: 1 })
    // `original` is patient speech and `suggested` is the table's reading of it.
    expect(JSON.stringify(db.auditWrites)).not.toMatch(/teman|demam/)
  })

  it('returns 404, never 403, for a consultation owned by someone else', async () => {
    db.owner = 'doctor-2'
    const response = await post()
    // A 403 would confirm the record exists. See lib/authz.ts.
    expect(response.status).toBe(404)
  })

  it.each(['awaiting_review', 'approved'] as const)('refuses in %s with 409', async (status) => {
    db.status = status
    const response = await post()
    // Past draft the note was built from these words, so correcting them would
    // leave the note grounded in text the record no longer holds.
    expect(response.status).toBe(409)
    expect(db.consultationUpdates).toHaveLength(0)
  })

  it('records the failure when there is no usable transcript', async () => {
    db.transcript = null
    const response = await post()

    expect(response.status).toBe(409)
    expect(auditActions()).toEqual(['consultation.corrections_failed'])
    expect(db.auditWrites[0]?.data.metadata).toEqual({ reason: 'no_transcript' })
  })

  it('proposes nothing on a typed transcript, and still records the row', async () => {
    db.transcript = { source: 'paste', labelsReviewed: true, turns: RECORDED.turns }
    const response = await post()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ proposals: [] })
    expect(db.auditWrites[0]?.data.metadata).toEqual({ proposalCount: 0 })
  })

  it('registers its own rate limiter ahead of the router', async () => {
    // security.md: any new route must register its own limiter, and it goes in
    // app.ts on the bare path so it runs whichever router later owns it. The
    // mounted app above cannot show this, because a limiter that was never
    // registered simply never runs.
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')

    expect(app).toContain(
      "app.post('/api/consultations/:id/transcript-corrections', transcriptCorrectionsRateLimit)",
    )
  })
})
