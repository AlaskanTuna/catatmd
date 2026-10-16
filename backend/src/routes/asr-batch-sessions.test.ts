import type { Server } from 'node:http'
import { BATCH_ASR_UPLOAD_URL, BatchSessionSchema, LiveAsrConfigSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level tests for the batch refinement mint (#436, docs/trd.md §20.14).
 *
 * Mirrors `asr-live-sessions.test.ts`, because the property is the same one a
 * step later: **the route never receives audio.** The browser uploads the
 * finished recording straight to the vendor, so what has to hold here is that
 * a single-use token is issued only to an authenticated caller who asserted
 * consent and a bounded duration, that it is audited before it is handed over,
 * and that neither the token nor any upstream text reaches a log or a row.
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
  ELEVENLABS_API_KEY: 'test-elevenlabs-key' as string | undefined,
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

const auditState = vi.hoisted(() => ({
  writes: [] as { data: Record<string, unknown> }[],
  failNextWrite: false,
}))

vi.mock('../lib/prisma.js', () => {
  const auditEvent = {
    create: async (args: { data: Record<string, unknown> }) => {
      if (auditState.failNextWrite) {
        auditState.failNextWrite = false
        throw new Error('audit store offline')
      }
      auditState.writes.push(args)
      return args.data
    },
    findFirst: async () => {
      const head = auditState.writes.at(-1)
      return head === undefined ? null : { hash: head.data.hash }
    },
    findMany: async () => [],
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mintedToken = () => jsonResponse({ token: 'single-use-batch-token' })

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

afterAll(() => {
  vi.unstubAllGlobals()
  server.close()
})

beforeEach(() => {
  upstream.mockReset()
  auditState.writes.length = 0
  auditState.failNextWrite = false
  testEnv.ELEVENLABS_API_KEY = 'test-elevenlabs-key'
  testEnv.SONIOX_API_KEY = 'test-soniox-key'
  sessionState.doctorId = 'doctor-1'
})

/** A fresh address per call keeps the 5/min bucket out of unrelated tests. */
let caller = 0

const nextIp = () => `198.51.100.${++caller % 250}`

const VALID = { consent: true, durationSeconds: 300 }

const mint = (body: unknown = VALID, ip?: string) =>
  realFetch(`${origin}/api/asr/batch-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? nextIp() },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const readConfig = (query = '') =>
  realFetch(`${origin}/api/asr/live-sessions/config${query}`, {
    headers: { 'x-forwarded-for': nextIp() },
  })

const auditActions = () => auditState.writes.map((write) => write.data.action)

describe('GET /live-sessions/config, which says whether refinement is on offer', () => {
  it('offers refinement on untranslated ambient when the key is set', async () => {
    const body = LiveAsrConfigSchema.parse(await (await readConfig()).json())

    expect(body.batchRefinement).toBe(true)
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('does not offer it when the key is unset', async () => {
    testEnv.ELEVENLABS_API_KEY = undefined

    const body = LiveAsrConfigSchema.parse(await (await readConfig()).json())

    expect(body.batchRefinement).toBeUndefined()
  })

  it.each(['?mode=dictation', '?translation=bn', '?translation=zh'])(
    'never offers it on %s, which the grant does not cover',
    async (query) => {
      const body = LiveAsrConfigSchema.parse(await (await readConfig(query)).json())

      expect(body.batchRefinement).toBeUndefined()
    },
  )
})

describe('pre-flight rejections, which mint nothing and audit nothing', () => {
  it('answers 503 with no upstream call when no key is configured', async () => {
    testEnv.ELEVENLABS_API_KEY = undefined

    const res = await mint()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'asr_unavailable' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('requires a session', async () => {
    sessionState.doctorId = undefined

    const res = await mint()

    expect(res.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it.each([
    [{}, 'Consent for this consultation is required.'],
    [{ durationSeconds: 300 }, 'Consent for this consultation is required.'],
    [{ consent: false, durationSeconds: 300 }, 'Consent for this consultation is required.'],
    [{ consent: 'yes', durationSeconds: 300 }, 'Consent for this consultation is required.'],
    [{ consent: true }, 'A recording duration within the refinement bound is required.'],
    [
      { consent: true, durationSeconds: 0 },
      'A recording duration within the refinement bound is required.',
    ],
    [
      { consent: true, durationSeconds: 1_861 },
      'A recording duration within the refinement bound is required.',
    ],
    [
      { consent: true, durationSeconds: 12.5 },
      'A recording duration within the refinement bound is required.',
    ],
    [
      { consent: true, durationSeconds: 'MARKER_BODY_ECHO_3391' },
      'A recording duration within the refinement bound is required.',
    ],
  ])('answers %j with a static 400', async (body, message) => {
    const res = await mint(body)

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'invalid_body', message } })
    // Static text per cause: the caller's value is never echoed.
    expect(text).not.toContain('MARKER_BODY_ECHO_3391')
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('names consent first when both consent and duration are wrong', async () => {
    const res = await mint({ consent: false, durationSeconds: 0 })

    await expect(res.json()).resolves.toMatchObject({
      error: { message: 'Consent for this consultation is required.' },
    })
  })

  it('bounds one caller to five refinements a minute', async () => {
    upstream.mockImplementation(async () => mintedToken())
    const ip = '198.51.100.251'

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await mint(VALID, ip)).status)

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
    expect(upstream).toHaveBeenCalledTimes(5)
    expect(auditActions()).toEqual(Array(5).fill('asr.batch_session_minted'))
  })

  it('spends its own bucket, never the ambient session one', async () => {
    upstream.mockImplementation(async () => mintedToken())
    const ip = '198.51.100.252'

    for (let i = 0; i < 6; i++) await mint(VALID, ip)
    expect((await mint(VALID, ip)).status).toBe(429)

    upstream.mockImplementation(async () =>
      jsonResponse({ api_key: 'temp', expires_at: '2026-10-16T00:00:00Z' }),
    )
    const live = await realFetch(`${origin}/api/asr/live-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ consent: true }),
    })
    expect(live.status).toBe(200)
  })
})

describe('the mint, and the row that must precede it reaching the client', () => {
  it('hands back a session the shared contract accepts', async () => {
    upstream.mockResolvedValueOnce(mintedToken())

    const res = await mint()

    expect(res.status).toBe(200)
    const body = BatchSessionSchema.safeParse(await res.json())
    expect(body.success).toBe(true)
    if (body.success) {
      expect(body.data.provider).toBe('elevenlabs')
      expect(body.data.uploadUrl).toBe(BATCH_ASR_UPLOAD_URL)
      expect(body.data.token).toBe('single-use-batch-token')
      expect(body.data.config.modelId).toBe('scribe_v2')
      expect(body.data.config.numSpeakers).toBe(2)
    }
  })

  it('is never cached', async () => {
    upstream.mockResolvedValueOnce(mintedToken())

    const res = await mint()

    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('records the duration the client asserted, the model, and the consent', async () => {
    upstream.mockResolvedValueOnce(mintedToken())

    await mint({ consent: true, durationSeconds: 742 })

    expect(auditActions()).toEqual(['asr.batch_session_minted'])
    expect(auditState.writes[0]?.data).toMatchObject({
      actorId: 'doctor-1',
      metadata: { model: 'scribe_v2', durationSeconds: 742, consentAsserted: true },
    })
  })

  it('never records the token it just issued', async () => {
    upstream.mockResolvedValueOnce(mintedToken())

    await mint()

    expect(JSON.stringify(auditState.writes)).not.toContain('single-use-batch-token')
  })

  it('fails the request when the trail cannot record it', async () => {
    upstream.mockResolvedValueOnce(mintedToken())
    auditState.failNextWrite = true

    const res = await mint()

    // Unguarded on purpose: a token the trail did not record must never be
    // observable by a client.
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('single-use-batch-token')
  })
})

describe('upstream failures, each audited exactly once', () => {
  it.each([
    [401, 503, 'asr_unavailable', 'rejected'],
    [403, 503, 'asr_unavailable', 'rejected'],
    [429, 429, 'rate_limited', 'rate_limited'],
    [500, 502, 'asr_failed', 'unavailable'],
  ])('maps upstream %i to %i %s', async (upstreamStatus, status, code, reason) => {
    upstream.mockResolvedValueOnce(jsonResponse({ detail: 'upstream detail' }, upstreamStatus))

    const res = await mint()

    expect(res.status).toBe(status)
    await expect(res.json()).resolves.toMatchObject({ error: { code } })
    expect(auditActions()).toEqual(['asr.batch_session_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({ metadata: { reason } })
  })

  it('treats an unreachable provider as a failed session', async () => {
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'))

    const res = await mint()

    expect(res.status).toBe(502)
    expect(auditActions()).toEqual(['asr.batch_session_failed'])
  })

  it('refuses a minted token the session contract would not carry, auditing it once', async () => {
    // Parsed before the success row, so a recorded mint is never followed by a
    // body the browser would refuse.
    upstream.mockResolvedValueOnce(jsonResponse({ token: 'x'.repeat(4_097) }))

    const res = await mint()

    expect(res.status).toBe(502)
    expect(auditActions()).toEqual(['asr.batch_session_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({ metadata: { reason: 'unavailable' } })
  })

  it('fails the request when the failure row cannot be written', async () => {
    upstream.mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, 500))
    auditState.failNextWrite = true

    const res = await mint()

    expect(res.status).toBe(500)
    expect(auditState.writes).toEqual([])
  })
})

describe('credential containment (the logger.leak.test.ts pattern)', () => {
  const UPSTREAM_ERROR_MARKER = 'MARKER_UPSTREAM_BODY_7720 invalid key xi-live-abcdef'

  async function withCapturedLogs(run: () => Promise<void>): Promise<string> {
    const captured: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk))
      return true
    })
    try {
      await run()
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      spy.mockRestore()
    }
    return captured.join('')
  }

  it('delivers the token to the caller and to no other drain', async () => {
    upstream.mockResolvedValueOnce(mintedToken())

    let body = ''
    const logs = await withCapturedLogs(async () => {
      const res = await mint()
      body = await res.text()
    })

    expect(body).toContain('single-use-batch-token')
    expect(logs).not.toContain('single-use-batch-token')
    expect(JSON.stringify(auditState.writes)).not.toContain('single-use-batch-token')
  })

  it('never echoes an upstream error body, which on this path names a credential', async () => {
    upstream.mockResolvedValueOnce(jsonResponse({ detail: UPSTREAM_ERROR_MARKER }, 401))

    let body = ''
    const logs = await withCapturedLogs(async () => {
      const res = await mint()
      body = await res.text()
    })

    expect(body).not.toContain(UPSTREAM_ERROR_MARKER)
    expect(logs).not.toContain(UPSTREAM_ERROR_MARKER)
    expect(JSON.stringify(auditState.writes)).not.toContain(UPSTREAM_ERROR_MARKER)
  })
})
