import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level tests for the hosted-ASR relay (#154): auth-adjacent pre-flight
 * behaviour, the upstream error mapping, the audit pair, and the property the
 * whole feature rests on, that recording content reaches only the caller and
 * never a log line or an audit row.
 *
 * The env module is mocked so the suite behaves identically with and without a
 * real `ILMU_API_KEY` in the root `.env` (locally it is set, in CI it is not).
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
 * The route reaches ILMU through global fetch, so that is what gets stubbed.
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
  testEnv.ILMU_API_KEY = 'test-key'
  sessionState.doctorId = 'doctor-1'
})

/** A fresh address per call keeps the 5/min bucket out of unrelated tests. */
let caller = 0

const post = (body: Buffer | string | null, headers: Record<string, string> = {}, ip?: string) =>
  realFetch(`${origin}/api/asr/transcriptions`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip ?? `198.51.100.${++caller % 250}`, ...headers },
    body,
  })

const webmBytes = () => Buffer.from('webm-bytes-for-testing')

const postAudio = (ip?: string) => post(webmBytes(), { 'content-type': 'audio/webm' }, ip)

const auditActions = () => auditState.writes.map((write) => write.data.action)

describe('pre-flight rejections, which egress nothing and audit nothing', () => {
  it('answers 503 with no upstream call when no key is configured', async () => {
    testEnv.ILMU_API_KEY = undefined

    const res = await postAudio()

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'asr_unavailable' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 415 for a non-audio content type', async () => {
    const res = await post(JSON.stringify({ audio: 'nope' }), {
      'content-type': 'application/json',
    })

    expect(res.status).toBe(415)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'unsupported_media_type' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 415 for a compressed request body without inflating it', async () => {
    const res = await post(webmBytes(), {
      'content-type': 'audio/webm',
      'content-encoding': 'gzip',
    })

    expect(res.status).toBe(415)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'unsupported_media_type' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 401 from the doctorId backstop when the session middleware injects no doctor', async () => {
    sessionState.doctorId = undefined

    const res = await postAudio()

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'unauthenticated' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('refuses a third concurrent relay with 503 while two slots are held', async () => {
    const resolvers: ((response: Response) => void)[] = []
    upstream.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const first = postAudio()
    const second = postAudio()
    await vi.waitFor(() => {
      expect(upstream).toHaveBeenCalledTimes(2)
    })

    const third = await postAudio()
    expect(third.status).toBe(503)
    await expect(third.json()).resolves.toMatchObject({ error: { code: 'asr_unavailable' } })
    expect(upstream).toHaveBeenCalledTimes(2)

    for (const resolve of resolvers) resolve(jsonResponse({ text: 'x', usage: { seconds: 1 } }))
    const [a, b] = await Promise.all([first, second])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(auditActions()).toEqual(['asr.hosted_relayed', 'asr.hosted_relayed'])
  })

  it('answers 400 for an empty audio body', async () => {
    const res = await post(null, { 'content-type': 'audio/webm' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 413 through the error envelope for a body over 25 MB', async () => {
    const res = await post(Buffer.alloc(26 * 1024 * 1024), { 'content-type': 'audio/webm' })

    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'audio_too_large' } })
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  }, 20_000)

  it('refuses the sixth request in a minute from one caller with 429', async () => {
    // A fresh Response per call: a body can only be read once.
    upstream.mockImplementation(async () => jsonResponse({ text: 'x', usage: { seconds: 1 } }))
    const CALLER = '203.0.113.99'

    let limited: Response | undefined
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      const response = await postAudio(CALLER)
      if (response.status === 429) {
        limited = response
        break
      }
    }

    expect(limited?.status, 'a sixth request in the window must be refused').toBe(429)
    await expect(limited?.json()).resolves.toMatchObject({ error: { code: 'rate_limited' } })
    // The refused request egressed nothing, so it audited nothing: only the
    // five relayed requests have rows.
    expect(auditActions()).toEqual(Array(5).fill('asr.hosted_relayed'))
  }, 20_000)
})

describe('the relay pair: egress, audit, respond', () => {
  it('returns the mapped result and audits the egress before responding', async () => {
    upstream.mockResolvedValueOnce(
      jsonResponse({ text: 'batuk sudah tiga hari', usage: { type: 'duration', seconds: 83.4 } }),
    )

    const res = await postAudio()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      text: 'batuk sudah tiga hari',
      durationSeconds: 83.4,
      segments: [],
    })

    expect(upstream).toHaveBeenCalledTimes(1)
    expect(auditState.writes).toHaveLength(1)
    expect(auditState.writes[0]?.data).toMatchObject({
      action: 'asr.hosted_relayed',
      actorId: 'doctor-1',
      consultationId: null,
      metadata: { durationSeconds: 83.4, model: 'ilmu-asr-v4.2' },
    })
  })

  it('fails the request when the success audit write fails: no unaudited egress response', async () => {
    upstream.mockResolvedValueOnce(jsonResponse({ text: 'x', usage: { seconds: 1 } }))
    auditState.failNextWrite = true

    const res = await postAudio()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'internal_error' } })
    expect(auditState.writes).toEqual([])
  })

  it.each([
    [400, 400, 'asr_rejected_audio', 'rejected_audio'],
    [402, 503, 'asr_unavailable', 'no_allocation'],
    [413, 413, 'audio_too_large', 'too_large'],
    [429, 429, 'rate_limited', 'rate_limited'],
    [500, 502, 'asr_failed', 'unavailable'],
  ] as const)(
    'maps upstream %i to %i %s and audits reason %s',
    async (upstreamStatus, status, code, reason) => {
      upstream.mockResolvedValueOnce(
        new Response('MARKER_UPSTREAM_BODY_7742', { status: upstreamStatus }),
      )

      const res = await postAudio()

      expect(res.status).toBe(status)
      const body = await res.text()
      expect(JSON.parse(body)).toMatchObject({ error: { code } })
      expect(body).not.toContain('MARKER_UPSTREAM_BODY_7742')

      expect(auditActions()).toEqual(['asr.hosted_relay_failed'])
      expect(auditState.writes[0]?.data).toMatchObject({
        actorId: 'doctor-1',
        consultationId: null,
        metadata: { reason },
      })
    },
  )

  it('maps a network failure to 502 and audits it: the attempt is recorded', async () => {
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'))

    const res = await postAudio()

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'asr_failed' } })
    expect(auditActions()).toEqual(['asr.hosted_relay_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({ metadata: { reason: 'unavailable' } })
  })
})

describe('content containment (the logger.leak.test.ts pattern)', () => {
  const TRANSCRIPT_MARKER = 'MARKER_TRANSCRIPT_9911 saya batuk teruk tiga hari'
  const UPSTREAM_ERROR_MARKER = 'MARKER_UPSTREAM_BODY_7742 nama saya faizal'

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

  it('delivers the transcript to the caller and to no other drain', async () => {
    upstream.mockResolvedValueOnce(jsonResponse({ text: TRANSCRIPT_MARKER, usage: { seconds: 9 } }))

    let body = ''
    const logs = await withCapturedLogs(async () => {
      const res = await postAudio()
      body = await res.text()
    })

    // The caller gets the transcript; that is the product.
    expect(body).toContain('MARKER_TRANSCRIPT_9911')

    // Absence proves nothing if nothing was written.
    expect(logs.length).toBeGreaterThan(0)
    expect(logs).toContain('hosted asr relayed')

    expect(logs).not.toContain('MARKER_TRANSCRIPT_9911')
    expect(JSON.stringify(auditState.writes)).not.toContain('MARKER_TRANSCRIPT_9911')
  })

  it('keeps an upstream error body out of the response, the logs, and the audit row', async () => {
    upstream.mockResolvedValueOnce(new Response(UPSTREAM_ERROR_MARKER, { status: 500 }))

    let body = ''
    const logs = await withCapturedLogs(async () => {
      const res = await postAudio()
      body = await res.text()
    })

    expect(body).not.toContain('MARKER_UPSTREAM_BODY_7742')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs).toContain('hosted asr relay failed')
    expect(logs).not.toContain('MARKER_UPSTREAM_BODY_7742')
    expect(JSON.stringify(auditState.writes)).not.toContain('MARKER_UPSTREAM_BODY_7742')
  })
})
