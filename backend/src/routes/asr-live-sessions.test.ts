import type { Server } from 'node:http'
import { LiveAsrConfigSchema, LiveSessionSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level tests for the ambient session mint (#268).
 *
 * The property under test is unusual for this repo: **the route never receives
 * audio**. The stream runs from the browser to the provider, so what has to
 * hold here is that a key is issued only to an authenticated caller who has
 * asserted consent, that it is bounded, that it is audited before it is handed
 * over, and that neither the key nor any upstream text reaches a log or a row.
 *
 * The env module is mocked so the suite behaves identically with and without a
 * real `SONIOX_API_KEY` in the root `.env` (locally it may be set, in CI it is
 * not).
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

/**
 * The route reaches Soniox through global fetch, so that is what gets stubbed.
 * The tests' own client calls must keep working, so the real fetch is captured
 * first and used for everything aimed at the local listener.
 */
const realFetch = globalThis.fetch
const upstream = vi.fn<typeof fetch>()

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mintedKey = (extra: Record<string, unknown> = {}) =>
  jsonResponse({ api_key: 'temp-session-key', expires_at: '2026-09-06T12:01:00Z', ...extra })

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
  testEnv.SONIOX_API_KEY = 'test-soniox-key'
  testEnv.SONIOX_REGION = 'us'
  sessionState.doctorId = 'doctor-1'
})

/** A fresh address per call keeps the 5/min bucket out of unrelated tests. */
let caller = 0

const nextIp = () => `203.0.113.${++caller % 250}`

const mint = (body: unknown = { consent: true }, ip?: string) =>
  realFetch(`${origin}/api/asr/live-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? nextIp() },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const readConfig = () =>
  realFetch(`${origin}/api/asr/live-sessions/config`, {
    headers: { 'x-forwarded-for': nextIp() },
  })

const auditActions = () => auditState.writes.map((write) => write.data.action)

describe('GET /live-sessions/config, which egresses nothing', () => {
  it('describes where audio would go, without minting or auditing anything', async () => {
    const res = await readConfig()

    expect(res.status).toBe(200)
    const body = LiveAsrConfigSchema.safeParse(await res.json())
    expect(body.success).toBe(true)
    if (body.success) {
      expect(body.data.provider).toBe('soniox')
      expect(body.data.region).toBe('us')
      expect(body.data.websocketUrl).toBe('wss://stt-rt.soniox.com/transcribe-websocket')
      expect(body.data.config.languageHints).toEqual(['ms', 'en', 'zh', 'ta'])
    }
    // A doctor reading the consent copy must not spend a key to see it.
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('names the configured region, so the copy and the socket cannot disagree', async () => {
    testEnv.SONIOX_REGION = 'jp'

    const body = (await (await readConfig()).json()) as { region: string; websocketUrl: string }

    expect(body.region).toBe('jp')
    expect(body.websocketUrl).toBe('wss://stt-rt.jp.soniox.com/transcribe-websocket')
  })

  it('answers 503 when no key is configured', async () => {
    testEnv.SONIOX_API_KEY = undefined

    const res = await readConfig()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'asr_unavailable' } })
  })

  it('requires a session', async () => {
    sessionState.doctorId = undefined

    expect((await readConfig()).status).toBe(401)
  })
})

describe('pre-flight rejections, which mint nothing and audit nothing', () => {
  it('answers 503 with no upstream call when no key is configured', async () => {
    testEnv.SONIOX_API_KEY = undefined

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

  it('refuses a body that does not assert consent', async () => {
    // Not a state the route reasons about: without the assertion there is
    // nothing to mint a key for, so it is a malformed body.
    //
    // Syntactically broken JSON is deliberately not in this list. The global
    // `express.json` parser rejects it before any route sees it, and
    // `errorHandler` has no body-parser branch, so it surfaces as a generic
    // 500 on every JSON route in the app. That is pre-existing and not this
    // route's to fix; asserting 400 here would be asserting a behaviour the
    // API does not have.
    for (const body of [{}, { consent: false }, { consent: 'yes' }]) {
      const res = await mint(body)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    }
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('bounds one caller to five sessions a minute', async () => {
    upstream.mockImplementation(async () => mintedKey())
    const ip = '203.0.113.251'

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await mint({ consent: true }, ip)).status)

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
    // The sixth was refused before the route ran, so it minted nothing.
    expect(upstream).toHaveBeenCalledTimes(5)
    expect(auditActions()).toEqual(Array(5).fill('asr.live_session_minted'))
  })
})

describe('the mint, and the row that must precede it reaching the client', () => {
  it('hands back a session the shared contract accepts', async () => {
    upstream.mockResolvedValueOnce(mintedKey())

    const res = await mint()

    expect(res.status).toBe(200)
    const body = LiveSessionSchema.safeParse(await res.json())
    expect(body.success).toBe(true)
    if (body.success) {
      expect(body.data.apiKey).toBe('temp-session-key')
      expect(body.data.expiresAt).toBe('2026-09-06T12:01:00Z')
      expect(body.data.websocketUrl).toBe('wss://stt-rt.soniox.com/transcribe-websocket')
    }
  })

  it('records the session against the reference id the provider was given', async () => {
    upstream.mockResolvedValueOnce(mintedKey())

    await mint()

    expect(auditActions()).toEqual(['asr.live_session_minted'])
    const sentReference = (
      JSON.parse(String(upstream.mock.calls[0]?.[1]?.body)) as { client_reference_id: string }
    ).client_reference_id
    expect(auditState.writes[0]?.data).toMatchObject({
      actorId: 'doctor-1',
      metadata: {
        // What makes our row reconcilable against the provider's usage log for
        // an egress this server never observes.
        clientReferenceId: sentReference,
        model: 'stt-rt-v5',
        region: 'us',
        maxSessionSeconds: 1800,
        consentAsserted: true,
      },
    })
  })

  it('never records the key it just issued', async () => {
    upstream.mockResolvedValueOnce(mintedKey())

    await mint()

    expect(JSON.stringify(auditState.writes)).not.toContain('temp-session-key')
  })

  it('fails the request when the trail cannot record it', async () => {
    upstream.mockResolvedValueOnce(mintedKey())
    auditState.failNextWrite = true

    const res = await mint()

    // Unguarded on purpose: a key the trail did not record must never be
    // observable by a client.
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('temp-session-key')
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
    expect(auditActions()).toEqual(['asr.live_session_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({ metadata: { reason } })
  })

  it('treats an unreachable provider as a failed session', async () => {
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'))

    const res = await mint()

    expect(res.status).toBe(502)
    expect(auditActions()).toEqual(['asr.live_session_failed'])
  })
})

describe('credential containment (the logger.leak.test.ts pattern)', () => {
  const UPSTREAM_ERROR_MARKER = 'MARKER_UPSTREAM_BODY_5518 invalid key sk-live-abcdef'

  async function withCapturedLogs(run: () => Promise<void>): Promise<string> {
    const captured: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk))
      return true
    })
    try {
      await run()
      // The request-context log line lands on `finish`, after the response.
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      spy.mockRestore()
    }
    return captured.join('')
  }

  it('delivers the key to the caller and to no other drain', async () => {
    upstream.mockResolvedValueOnce(mintedKey())

    let body = ''
    const logs = await withCapturedLogs(async () => {
      const res = await mint()
      body = await res.text()
    })

    expect(body).toContain('temp-session-key')
    expect(logs).not.toContain('temp-session-key')
    expect(JSON.stringify(auditState.writes)).not.toContain('temp-session-key')
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
