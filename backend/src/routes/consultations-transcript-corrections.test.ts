import type { Server } from 'node:http'
import { TranscriptCorrectionsResponseSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLLMClient } from '../lib/llm/index.js'

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
  // Flipped per test. The route reads this per request rather than at import,
  // so mutating it here is enough and no module needs re-importing.
  TRANSCRIPT_CLEANUP: 'off' as 'on' | 'off',
}))

vi.mock('../config/env.js', () => ({ env: testEnv }))

vi.mock('../lib/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/index.js')>()
  return { ...actual, getLLMClient: vi.fn() }
})

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
  testEnv.TRANSCRIPT_CLEANUP = 'off'
  vi.mocked(getLLMClient).mockReset()
})

/*
 * Every test below shares one rate-limit bucket, because they share a client
 * address and the limiter is real rather than mocked. `transcriptCorrections`
 * allows 20 a minute, so a suite that grows past that starts failing with 429s
 * that look nothing like the assertion that broke. If that happens, reset the
 * limiter here rather than raising a production bound to fit a test.
 */

/**
 * The same consultation, with the recogniser's own doubt recorded on it (#309).
 *
 * `uncertain` is the gate: without it the constrained pass short-circuits before
 * de-identifying anything, so a cleanup test has to supply one.
 */
const UNCERTAIN = {
  source: 'asr_live',
  turns: [
    { speaker: 'doctor', text: 'Ada apa hari ini?' },
    {
      speaker: 'patient',
      text: 'Saya ada teman dua hari.',
      uncertain: [{ start: 9, end: 14 }],
    },
  ],
}

const stubClient = (generate: () => Promise<unknown>) => {
  vi.mocked(getLLMClient).mockReturnValue({
    provider: 'qwen',
    model: 'test-model',
    generate: vi.fn(generate),
  } as never)
}

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
      { turnIndex: 1, start: 9, original: 'teman', suggested: 'demam', source: 'mishear' },
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
    expect(metadata).toEqual({
      proposalCount: 1,
      modelProposalCount: 0,
      droppedCount: 0,
      cleanup: 'disabled',
    })
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
    // `cleanup: 'disabled'` rather than a bare empty list. A pass that never
    // ran and a pass that found nothing are different facts (#309).
    expect(await response.json()).toEqual({ proposals: [], cleanup: 'disabled' })
    expect(db.auditWrites[0]?.data.metadata).toEqual({
      proposalCount: 0,
      modelProposalCount: 0,
      droppedCount: 0,
      cleanup: 'disabled',
    })
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

describe('the constrained cleanup pass on the same route (#309)', () => {
  it('reaches no provider while it is switched off, even with uncertainty recorded', async () => {
    db.transcript = structuredClone(UNCERTAIN)
    stubClient(async () => ({ edits: [{ original: 'teman', replacement: 'demam' }] }))

    const body = TranscriptCorrectionsResponseSchema.safeParse(await (await post()).json())

    expect(vi.mocked(getLLMClient)).not.toHaveBeenCalled()
    expect(body.success && body.data.cleanup).toBe('disabled')
  })

  it('adds a model proposal beside the measured one, each naming its source', async () => {
    db.transcript = structuredClone(UNCERTAIN)
    testEnv.TRANSCRIPT_CLEANUP = 'on'
    // "ada" sits inside the uncertain span and is not a table pair, so it can
    // only have come from the model.
    stubClient(async () => ({ edits: [{ original: 'dua', replacement: 'due' }] }))
    db.transcript = {
      source: 'asr_live',
      turns: [
        { speaker: 'doctor', text: 'Ada apa hari ini?' },
        {
          speaker: 'patient',
          text: 'Saya ada teman dua hari.',
          uncertain: [
            { start: 9, end: 14 },
            { start: 15, end: 18 },
          ],
        },
      ],
    }

    const response = await post()
    const parsed = TranscriptCorrectionsResponseSchema.safeParse(await response.json())

    expect(response.status).toBe(200)
    expect(parsed.success).toBe(true)
    const sources = parsed.success ? parsed.data.proposals.map((p) => p.source) : []
    expect(sources).toEqual(['mishear', 'model'])
    expect(parsed.success && parsed.data.cleanup).toBe('ok')
  })

  it('still serves the measured proposals with 200 when the provider fails', async () => {
    // The acceptance criterion this route exists to keep: layer 2 shipped
    // unconditionally and layer 3 falling over must not take it off the screen.
    db.transcript = structuredClone(UNCERTAIN)
    testEnv.TRANSCRIPT_CLEANUP = 'on'
    stubClient(async () => {
      throw new Error('provider exploded')
    })

    const response = await post()
    const parsed = TranscriptCorrectionsResponseSchema.safeParse(await response.json())

    expect(response.status).toBe(200)
    expect(parsed.success && parsed.data.cleanup).toBe('failed')
    expect(parsed.success && parsed.data.proposals).toEqual([
      { turnIndex: 1, start: 9, original: 'teman', suggested: 'demam', source: 'mishear' },
    ])
  })

  it('records the model counts and still never the words', async () => {
    db.transcript = structuredClone(UNCERTAIN)
    testEnv.TRANSCRIPT_CLEANUP = 'on'
    stubClient(async () => ({ edits: [{ original: 'hari', replacement: 'har' }] }))

    await post()

    expect(db.auditWrites[0]?.data.metadata).toEqual({
      proposalCount: 1,
      modelProposalCount: 0,
      droppedCount: 1,
      cleanup: 'ok',
    })
    expect(JSON.stringify(db.auditWrites)).not.toMatch(/teman|demam|hari/)
  })
})
