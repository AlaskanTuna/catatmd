import type { Server } from 'node:http'
import { LiveFlagsResponseSchema, MAX_LIVE_DELTA_TURNS } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for ambient capture's deterministic pane (#219).
 *
 * Three properties carry this route, and each has a test below that fails if it
 * is lost: it runs **no model** and so cannot be talked out of a flag, it
 * **persists nothing**, and it refuses to let a client hand it the one field
 * that could suppress a trigger.
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
  /** The one consultation that exists, owned by `doctor-1`. */
  owner: 'doctor-1' as string,
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
        ? { id: where.id, doctorId: db.owner, status: 'draft', erasedAt: null }
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

/** Any provider call would come through global fetch, so it is stubbed and watched. */
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
  db.auditWrites.length = 0
  db.consultationUpdates.length = 0
  upstream.mockReset()
})

type Turn = { speaker: 'doctor' | 'patient'; text: string }

const post = async (body: unknown, id = 'consultation-1') =>
  realFetch(`${origin}/api/consultations/${id}/live-flags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const delta = (turns: Turn[], labelsReviewed = false) => ({
  delta: { source: 'asr_live', labelsReviewed, turns },
})

describe('POST /api/consultations/:id/live-flags', () => {
  it('raises a rule flag from the window', async () => {
    const response = await post(
      delta([{ speaker: 'patient', text: "I've been coughing up blood since this morning." }]),
    )
    expect(response.status).toBe(200)

    const parsed = LiveFlagsResponseSchema.safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.redFlags.map((flag) => flag.id)).toContain('haemoptysis')
  })

  it('calls no model and reaches no provider', async () => {
    await post(delta([{ speaker: 'patient', text: 'I have chest pain that started yesterday.' }]))
    // The whole point of this pane: it is deterministic, so it cannot be
    // filtered, reordered or suppressed by a model that never ran.
    expect(upstream).not.toHaveBeenCalled()
  })

  it('writes no audit row and persists nothing', async () => {
    await post(delta([{ speaker: 'patient', text: 'I have chest pain that started yesterday.' }]))
    // Nothing egresses and no state changes, so there is no act to record. The
    // authoritative, audited run is still the one at Finish.
    expect(db.auditWrites).toHaveLength(0)
    expect(db.consultationUpdates).toHaveLength(0)
  })

  it('ignores a client claim that labels were reviewed', async () => {
    // `asserts()` suppresses a doctor's question answered by a leading denial,
    // but only when a human stands behind the labels. On a live path nobody
    // does, so the route forces `labelsReviewed: false` and the flag stands for
    // the doctor to dismiss. A client must not be able to buy the suppression.
    const turns: Turn[] = [
      { speaker: 'doctor', text: 'Any chest pain?' },
      { speaker: 'patient', text: 'No, none at all.' },
    ]

    const response = await post(delta(turns, true))
    const body = (await response.json()) as { redFlags: { id: string }[] }
    expect(body.redFlags.map((flag) => flag.id)).toContain('chest-pain')
  })

  it('ignores a client-supplied transcript source', async () => {
    /*
     * Found by clinical review, and the same class as `labelsReviewed`: on a
     * window the client composed entirely, `source` gates `isRecorded` in
     * `redflags/mishears.ts`, so sending anything but `asr_live` would silently
     * drop the measured Malay confusables that exist for this very path.
     */
    const response = await post({
      delta: {
        source: 'paste',
        labelsReviewed: false,
        turns: [{ speaker: 'patient' as const, text: 'Doktor, saya patuk berdarah pagi tadi.' }],
      },
    })

    const body = (await response.json()) as { redFlags: { id: string }[] }
    expect(body.redFlags.map((flag) => flag.id)).toContain('haemoptysis')
  })

  it('returns 404, never 403, for another doctor’s consultation', async () => {
    db.owner = 'doctor-2'
    const response = await post(delta([{ speaker: 'patient', text: 'Sore throat.' }]))
    expect(response.status).toBe(404)
  })

  it('refuses an unauthenticated caller', async () => {
    sessionState.doctorId = undefined
    const response = await post(delta([{ speaker: 'patient', text: 'Sore throat.' }]))
    expect(response.status).toBe(401)
  })

  it('refuses a window over the turn bound', async () => {
    const turns: Turn[] = Array.from({ length: MAX_LIVE_DELTA_TURNS + 1 }, () => ({
      speaker: 'patient' as const,
      text: 'A sentence.',
    }))
    const response = await post(delta(turns))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_body')
  })

  it('refuses a body with no delta at all', async () => {
    const response = await post({})
    expect(response.status).toBe(400)
  })
})
