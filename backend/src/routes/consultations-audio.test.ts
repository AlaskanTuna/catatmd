import type { Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for consultation audio storage (#293).
 *
 * Every control on these two routes was review-enforced only until this file
 * existed: nothing pinned the 415, the 413, the 404-on-an-unowned-id, the
 * retention 503, or `Cache-Control: no-store`. A control nothing tests is a
 * control a later refactor removes silently, and this route carries the one kind
 * of PHI in the system that cannot be de-identified.
 *
 * The ordering tests are the ones that matter most. Three gates run ahead of the
 * body parser precisely so a request that will be refused never costs 25 MB of
 * heap, and an ordinary request cannot show that: a 404 looks the same whether
 * or not the body was read first. Sending an oversized body is what makes it
 * observable, because the gate and the parser refuse with different codes.
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
  /** Mutable per test, because "unset" is itself one of the behaviours here. */
  AUDIO_RETENTION_HOURS: 720 as number | undefined,
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
  auditWrites: [] as Record<string, unknown>[],
  audio: new Map<string, { data: Uint8Array; mimeType: string; expiresAt: Date }>(),
}))

vi.mock('../lib/prisma.js', () => {
  const auditEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      db.auditWrites.push(data)
      return data
    },
    findFirst: async () => {
      const head = db.auditWrites.at(-1)
      return head === undefined ? null : { hash: head.hash }
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
    update: async ({ data }: { data: unknown }) => data,
    updateMany: async () => ({ count: 0 }),
    count: async () => 0,
  }
  const consultationAudio = {
    upsert: async ({
      where,
      create,
    }: {
      where: { consultationId: string }
      create: { data: Uint8Array; mimeType: string; expiresAt: Date }
    }) => {
      db.audio.set(where.consultationId, create)
      return create
    },
    findFirst: async ({
      where,
    }: {
      where: { consultationId: string; expiresAt?: { gt: Date } }
    }) => {
      const row = db.audio.get(where.consultationId)
      if (row === undefined) return null
      if (where.expiresAt && row.expiresAt.getTime() <= where.expiresAt.gt.getTime()) return null
      return row
    },
    deleteMany: async () => ({ count: 0 }),
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
          if (property === 'consultationAudio') return consultationAudio
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

let server: Server
let origin: string

beforeAll(async () => {
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  db.owner = 'doctor-1'
  db.auditWrites.length = 0
  db.audio.clear()
  sessionState.doctorId = 'doctor-1'
  testEnv.AUDIO_RETENTION_HOURS = 720
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Rotated so the per-IP limiters do not bleed across cases in this file. */
let clientIp = 0
const headers = (extra: Record<string, string> = {}) => ({
  'x-forwarded-for': `203.0.113.${++clientIp % 250}`,
  ...extra,
})

const put = (path: string, body: Uint8Array | string, contentType?: string) =>
  fetch(`${origin}${path}`, {
    method: 'PUT',
    headers: headers(contentType ? { 'content-type': contentType } : {}),
    body,
  })

const get = (path: string) => fetch(`${origin}${path}`, { headers: headers() })

const recording = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])

describe('storing a recording', () => {
  it('accepts an audio body and answers with the expiry it set', async () => {
    const response = await put('/api/consultations/c1/audio', recording(), 'audio/webm')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { expiresAt: string }
    const hours = (new Date(body.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(719)
    expect(db.audio.get('c1')?.mimeType).toBe('audio/webm')
  })

  it('refuses a body that is not audio, with 415', async () => {
    const response = await put('/api/consultations/c1/audio', 'not audio', 'text/plain')

    expect(response.status).toBe(415)
    expect(db.audio.size).toBe(0)
  })

  it('refuses an empty audio body, with 400', async () => {
    const response = await put('/api/consultations/c1/audio', new Uint8Array(), 'audio/webm')

    expect(response.status).toBe(400)
    expect(db.audio.size).toBe(0)
  })

  /*
   * The 413 is what `parseAudioBody` exists for. Without it the body parser's
   * own `entity.too.large` reaches `errorHandler`, which has no branch for it
   * and collapses it to a generic 500: the caller then cannot tell "too big"
   * from "server broken", and the operator sees a false fault.
   */
  it('maps an oversized body onto 413, not a generic 500', async () => {
    const oversized = new Uint8Array(26 * 1024 * 1024)

    const response = await put('/api/consultations/c1/audio', oversized, 'audio/webm')

    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('audio_too_large')
  })

  it('records the size and the window, and never the recording', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')

    const stored = db.auditWrites.find((row) => row.action === 'consultation.audio_stored')
    expect(stored).toBeDefined()
    expect(stored?.metadata).toEqual({ bytes: 4, retentionHours: 720 })
  })
})

describe('the gates that run before the body is read', () => {
  /*
   * An oversized body is what makes the ordering observable.
   *
   * The gates and the parser both refuse this request, but with different
   * codes, so the code says which ran first. Correct ordering answers 404 or
   * 503, because the gate fired before a byte was parsed. The broken ordering,
   * parser first, answers 413 instead: it read 25 MB it was always going to
   * throw away. Asserting from the client that the body was "not sent" cannot
   * work, because the client streams it regardless of what the server does.
   *
   * This is the property `routes/asr.ts` states and that #293 originally got
   * backwards: any authenticated caller could force a 25 MB allocation against
   * a record they cannot reach, and self-service sign-up has no email
   * verification.
   */
  const oversized = () => new Uint8Array(26 * 1024 * 1024)

  it('answers 404 for an unowned consultation rather than parsing the body first', async () => {
    db.owner = 'someone-else'

    const response = await put('/api/consultations/c1/audio', oversized(), 'audio/webm')

    // 404 and never 403: the API must not be an existence oracle. A 413 here
    // would mean the parser ran ahead of the ownership check.
    expect(response.status).toBe(404)
    expect(db.audio.size).toBe(0)
  })

  it('answers 503 with no retention period adopted rather than parsing the body first', async () => {
    testEnv.AUDIO_RETENTION_HOURS = undefined

    const response = await put('/api/consultations/c1/audio', oversized(), 'audio/webm')

    expect(response.status).toBe(503)
    const payload = (await response.json()) as { error: { code: string } }
    expect(payload.error.code).toBe('audio_retention_unset')
    expect(db.audio.size).toBe(0)
  })
})

describe('serving a recording', () => {
  it('returns the stored bytes with the container it arrived in', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')

    const response = await get('/api/consultations/c1/audio')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/webm')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(recording())
  })

  /*
   * PHI must not sit in a shared or disk cache, because nothing in this system
   * can reach into one to erase it when the consultation is erased.
   */
  it('forbids caching the response anywhere', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')

    const response = await get('/api/consultations/c1/audio')

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('is 404 for a consultation with no recording', async () => {
    const response = await get('/api/consultations/c1/audio')

    expect(response.status).toBe(404)
  })

  it('is 404 for a consultation the caller does not own', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')
    db.owner = 'someone-else'

    const response = await get('/api/consultations/c1/audio')

    expect(response.status).toBe(404)
  })

  /*
   * The read path checks the clock itself rather than trusting that the sweep
   * has run. A sweep that has not fired yet is untidiness; serving a recording
   * past its window would be a broken retention promise.
   */
  it('refuses an expired recording even though the row survives', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')
    const row = db.audio.get('c1')
    if (row) row.expiresAt = new Date(Date.now() - 1_000)

    const response = await get('/api/consultations/c1/audio')

    expect(response.status).toBe(404)
    expect(db.audio.size).toBe(1)
  })

  /*
   * Withdrawing the retention decision has to stop recordings being served, not
   * merely stop new ones arriving, or it is half a switch.
   */
  it('serves nothing once the retention period is withdrawn', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')
    testEnv.AUDIO_RETENTION_HOURS = undefined

    const response = await get('/api/consultations/c1/audio')

    expect(response.status).toBe(404)
  })

  it('records that a recording was served, with no content', async () => {
    await put('/api/consultations/c1/audio', recording(), 'audio/webm')
    db.auditWrites.length = 0

    await get('/api/consultations/c1/audio')

    const served = db.auditWrites.find((row) => row.action === 'consultation.audio_served')
    expect(served).toBeDefined()
    expect(served?.metadata).toBeUndefined()
  })
})
