import type { Server } from 'node:http'
import { PrescriptionParseResponseSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for dictated prescription capture (#312, `docs/decisions.md`
 * D-001).
 *
 * Four properties carry this feature: parsing **stores nothing**, it runs **no
 * model**, storing happens only through the doctor's own `PATCH`, and the audit
 * row carries a count and never a drug name.
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

const db = vi.hoisted(() => ({
  owner: 'doctor-1' as string,
  status: 'awaiting_review' as string,
  auditWrites: [] as { data: Record<string, unknown> }[],
  consultationUpdates: [] as Record<string, unknown>[],
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
  const row = (id: string) => ({
    id,
    doctorId: db.owner,
    status: db.status,
    erasedAt: null,
    title: null,
    noteTemplate: 'soap',
    captureMode: 'manual',
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: null,
    approvedById: null,
    patientId: null,
    transcript: null,
    analysis: null,
    editedNote: null,
    editedMedicalRecordNote: null,
    prescriptions: null,
    acknowledgedRedFlagIds: [],
    reviewedGapIds: [],
    redFlagDispositions: [],
    gapDispositions: [],
  })
  const consultation = {
    findFirst: async ({ where }: { where: { id: string; doctorId: string } }) =>
      where.doctorId === db.owner ? row(where.id) : null,
    findUnique: async () => null,
    findMany: async () => [],
    create: async ({ data }: { data: unknown }) => data,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      db.consultationUpdates.push(data)
      return { ...row('consultation-1'), ...data }
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
  db.status = 'awaiting_review'
  db.auditWrites.length = 0
  db.consultationUpdates.length = 0
  upstream.mockReset()
})

const parse = async (body: unknown, id = 'consultation-1') =>
  realFetch(`${origin}/api/consultations/${id}/prescriptions/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const patch = async (body: unknown, id = 'consultation-1') =>
  realFetch(`${origin}/api/consultations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/consultations/:id/prescriptions/parse', () => {
  it('parses an English dictation into structured fields', async () => {
    const response = await parse({ dictated: 'amoxicillin 500mg TDS after food for five days' })
    expect(response.status).toBe(200)

    const parsed = PrescriptionParseResponseSchema.safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.sig).toMatchObject({
      dose: '500 mg',
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
    })
  })

  it('parses the rojak form to the same values', async () => {
    // docs/trd.md section 20.1: Malaysian consultations are Malay-dominant with
    // English switches, and "medical vocabulary is English". The dosing is the
    // half that is not.
    const response = await parse({
      dictated: 'amoxicillin 500 mg, makan tiga kali sehari, lepas makan, selama lima hari',
    })
    const parsed = PrescriptionParseResponseSchema.safeParse(await response.json())

    expect(parsed.success && parsed.data.sig).toMatchObject({
      dose: '500 mg',
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
    })
  })

  it('reports how far the sig parse read, so a caller can bound one drug stretch', async () => {
    // The response carries one sig for the whole phrase, so a several-drug
    // dictation needs a second boundary beside the next drug name: a brand is
    // outside the lexicon by D-001 and raises no candidate to bound anything
    // (#369). Everything past this offset is text no prescription accounts for.
    const dictated =
      'dextromethorphan 15 mg oral three times a day after food for 5 days. ' +
      'strepsils lozenge 1 lozenge for 3 days.'
    const response = await parse({ dictated })
    const parsed = PrescriptionParseResponseSchema.safeParse(await response.json())

    const readTo = parsed.success ? parsed.data.sigReadTo : undefined
    expect(typeof readTo).toBe('number')
    expect(dictated.slice(0, readTo ?? 0)).toContain('for 5 days')
    expect(dictated.slice(0, readTo ?? 0)).not.toContain('strepsils')
  })

  it('reports a null offset when no field parsed, rather than zero', async () => {
    const response = await parse({ dictated: 'patient advised to rest' })
    const parsed = PrescriptionParseResponseSchema.safeParse(await response.json())

    expect(parsed.success && parsed.data.sigReadTo).toBeNull()
  })

  it('offers the drug as a candidate rather than substituting it', async () => {
    const response = await parse({ dictated: 'amoxycillin 500 mg' })
    const parsed = PrescriptionParseResponseSchema.safeParse(await response.json())

    // `heard` is what the doctor said and `generic` is the proposal. Both
    // travel, because the doctor is the one choosing between them.
    const top = parsed.success ? parsed.data.candidates[0] : undefined
    expect(top?.generic).toBe('amoxicillin')
    expect(top?.heard).toBe('amoxycillin')
  })

  it('stores nothing and writes no audit row', async () => {
    await parse({ dictated: 'amoxicillin 500 mg TDS' })
    // Parsing is read-only. The audited act is the doctor confirming, which is
    // the PATCH below.
    expect(db.consultationUpdates).toHaveLength(0)
    expect(db.auditWrites).toHaveLength(0)
  })

  it('reaches no provider', async () => {
    await parse({ dictated: 'amoxicillin 500 mg TDS' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('returns 404, never 403, for a consultation owned by someone else', async () => {
    db.owner = 'doctor-2'
    expect((await parse({ dictated: 'amoxicillin 500 mg' })).status).toBe(404)
  })

  it('rejects an empty dictation', async () => {
    expect((await parse({ dictated: '' })).status).toBe(400)
  })

  it('registers its own rate limiter ahead of the router', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(new URL('../app.ts', import.meta.url), 'utf8')
    expect(app).toContain(
      "app.post('/api/consultations/:id/prescriptions/parse', prescriptionParseRateLimit)",
    )
  })
})

describe('PATCH /api/consultations/:id { prescriptions }', () => {
  const confirmed = [
    {
      drug: 'amoxicillin',
      lexiconId: 'amoxicillin',
      dose: '500 mg',
      route: 'oral',
      frequency: 'three-times-daily',
      duration: '5 days',
      food: 'after',
      dictated: 'amoxicillin 500 mg, makan tiga kali sehari, lepas makan, selama lima hari',
    },
  ]

  it('stores the confirmed list', async () => {
    const response = await patch({ prescriptions: confirmed })
    expect(response.status).toBe(200)
    expect(db.consultationUpdates[0]?.prescriptions).toEqual(confirmed)
  })

  it('records a count and never a drug name', async () => {
    await patch({ prescriptions: confirmed })

    const write = db.auditWrites.find((w) => w.data.action === 'consultation.prescription_recorded')
    expect(write?.data.metadata).toEqual({ prescriptionCount: 1 })
    // The dictation is verbatim speech and the drug is clinical content.
    expect(JSON.stringify(db.auditWrites)).not.toMatch(/amoxicillin|makan/)
  })

  it('refuses once the note is approved', async () => {
    db.status = 'approved'
    const response = await patch({ prescriptions: confirmed })
    // `approved` is terminal by design, and a prescription recorded after it
    // would sit against a record nothing can change.
    expect(response.status).toBe(409)
    expect(db.consultationUpdates).toHaveLength(0)
  })

  it('rejects more than the bound', async () => {
    const response = await patch({
      prescriptions: Array.from({ length: 11 }, () => confirmed[0]),
    })
    expect(response.status).toBe(400)
  })
})
