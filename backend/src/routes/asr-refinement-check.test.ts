import type { Server } from 'node:http'
import { MAX_REFINEMENT_CHECK_TURNS, RefinementCheckResponseSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route-level tests for the refinement red-flag check (#436, docs/trd.md
 * §20.14).
 *
 * The client keeps the live transcript whenever the refined one would lose a
 * rule hit the live one raised. What has to hold here is the
 * `transcript-cleanup/policy.ts` discipline: the trigger set, the source, the
 * labels and the review state are all the server's, because each is a lever
 * that can only ever weaken the engine. Nothing egresses and nothing is
 * stored, so nothing is audited.
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
  sessionState.doctorId = 'doctor-1'
})

let caller = 0

const nextIp = () => `192.0.2.${++caller % 250}`

const check = (body: unknown, ip?: string) =>
  realFetch(`${origin}/api/asr/refinement-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? nextIp() },
    body: JSON.stringify(body),
  })

const lostIds = async (body: unknown): Promise<string[]> => {
  const res = await check(body)
  expect(res.status).toBe(200)
  const parsed = RefinementCheckResponseSchema.parse(await res.json())
  return parsed.lost.map((flag) => flag.ruleId ?? flag.id).sort()
}

describe('POST /refinement-check', () => {
  it('reports nothing lost when the refined transcript raises every live hit', async () => {
    expect(
      await lostIds({
        live: ['Doktor, saya batuk berdarah sejak pagi.'],
        refined: ['Doktor, saya batuk berdarah sejak pagi tadi.'],
      }),
    ).toEqual([])
    expect(upstream).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('reports a hit the refined transcript lost', async () => {
    expect(
      await lostIds({
        live: ['I have been coughing up blood since this morning.'],
        refined: ['I have been coughing since this morning.'],
      }),
    ).toEqual(['haemoptysis'])
  })

  it('catches a negation the refined transcript introduced outside the evidence span', async () => {
    // The case that killed the positional design in `policy.ts`: one word,
    // nowhere near the matched span, and the emergency flag is gone.
    expect(
      await lostIds({ live: ['Ada batuk berdarah.'], refined: ['Tiada batuk berdarah.'] }),
    ).toEqual(['haemoptysis'])
  })

  it('never reports a hit the refined transcript gained', async () => {
    // Gaining a flag can only add a candidate for the doctor; it is not a loss.
    expect(
      await lostIds({
        live: ['I have a cough.'],
        refined: ['I have a cough and chest pain that started yesterday.'],
      }),
    ).toEqual([])
  })

  it('evaluates every trigger there is, not one profile', async () => {
    // A urinary-tract trigger, outside the URTI profile the SPA defaults to: a
    // filtered set would let a refined transcript drop it unnoticed.
    expect(
      await lostIds({
        live: ['Dah dua hari kencing tak keluar.'],
        refined: ['Dah dua hari kencing.'],
      }),
    ).toContain('uti-unable-to-pass-urine')
  })

  it('ignores a profile, a source and a label review sent by the client', async () => {
    expect(
      await lostIds({
        live: ['I have been coughing up blood since this morning.'],
        refined: ['I have been coughing since this morning.'],
        profileId: 'adult-uti',
        source: 'paste',
        labelsReviewed: true,
      }),
    ).toEqual(['haemoptysis'])
  })

  it('labels no turn as the doctor, so advice cannot hide a symptom on one side only', async () => {
    /*
     * Before labelling there is no role, so every turn is read as the
     * patient's. That turns off the doctor-only safety-netting reading on both
     * sides alike, which can only make the check fire more: a symptom named in
     * advice on the live side still counts when the refined side drops it.
     */
    expect(
      await lostIds({
        live: ['Come back if you become breathless.'],
        refined: ['Come back if you become tired.'],
      }),
    ).toContain('significant-dyspnoea')
  })

  it('requires a session', async () => {
    sessionState.doctorId = undefined

    expect((await check({ live: ['x'], refined: ['x'] })).status).toBe(401)
  })

  it.each([
    [{}],
    [{ live: ['x'] }],
    [{ live: [], refined: ['x'] }],
    [{ live: ['x'], refined: [''] }],
    [{ live: ['x'.repeat(4_001)], refined: ['x'] }],
    [{ live: Array.from({ length: MAX_REFINEMENT_CHECK_TURNS + 1 }, () => 'ya'), refined: ['x'] }],
    [{ live: 'MARKER_BODY_ECHO_4410', refined: ['x'] }],
  ])('answers %# with a static 400', async (body) => {
    const res = await check(body)

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({
      error: { code: 'invalid_body', message: 'A live and a refined transcript are required.' },
    })
    expect(text).not.toContain('MARKER_BODY_ECHO_4410')
  })

  it('bounds one caller to ten checks a minute', async () => {
    const ip = '192.0.2.251'
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push((await check({ live: ['x'], refined: ['x'] }, ip)).status)
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })
})
