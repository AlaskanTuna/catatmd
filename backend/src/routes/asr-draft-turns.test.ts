import type { Server } from 'node:http'
import { DraftTurnsResponseSchema, MAX_DRAFT_TEXT_CHARACTERS } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeidentificationError } from '../deid/index.js'

/**
 * Route-level tests for the hosted-draft-labelling pass (#189): auth-adjacent
 * pre-flight behaviour, the LLM failure mapping, the audit pair, and the
 * property the whole feature rests on, that the raw transcript text reaches
 * the LLM mock only as pseudonym tokens and never appears in a log line or an
 * audit row.
 *
 * Cloned from `asr.test.ts`'s harness (env mock, session mock, prisma/audit
 * interception, fresh IP per request), but this route egresses through
 * `../lib/llm/index.js` rather than global fetch, so that module is mocked
 * instead. `deidentify` itself is left real: the containment assertions below
 * only mean something if the gate they exercise is the production one.
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
  QWEN_API_KEY: 'test-key' as string | undefined,
  QWEN_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  QWEN_MODEL: 'qwen3.7-flash',
  GEMINI_API_KEY: undefined as string | undefined,
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  DEEPSEEK_API_KEY: undefined as string | undefined,
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  ILMU_API_KEY: undefined as string | undefined,
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

const llmState = vi.hoisted(() => ({
  generate: vi.fn<(request: { operation: string; content: string }) => Promise<unknown>>(),
}))

vi.mock('../lib/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/index.js')>()
  return {
    ...actual,
    getLLMClient: vi.fn(() => ({
      provider: 'qwen',
      model: 'test-model',
      generate: llmState.generate,
    })),
    getLLMDescriptor: vi.fn(() => ({ provider: 'qwen', model: 'test-model' })),
  }
})

/** Echoes the de-identified content back as one turn: a trivially reconstructable draft. */
const echoAsSingleTurn = () =>
  llmState.generate.mockImplementation(async (request) => ({
    turns: [{ speaker: 'doctor', text: request.content }],
  }))

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

afterAll(() => {
  server.close()
})

beforeEach(() => {
  llmState.generate.mockReset()
  auditState.writes.length = 0
  auditState.failNextWrite = false
  sessionState.doctorId = 'doctor-1'
})

let caller = 0

const post = (body: unknown, ip?: string) =>
  fetch(`${origin}/api/asr/draft-turns`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip ?? `198.51.100.${++caller % 250}`,
    },
    body: JSON.stringify(body),
  })

const auditActions = () => auditState.writes.map((write) => write.data.action)

describe('pre-flight rejections, which egress nothing and audit nothing', () => {
  it('answers 401 when the session middleware injects no doctor', async () => {
    sessionState.doctorId = undefined

    const res = await post({ text: 'doctor how are you feeling' })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'unauthenticated' } })
    expect(llmState.generate).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 400 for a missing text field', async () => {
    const res = await post({})

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    expect(llmState.generate).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 400 for an empty text field', async () => {
    const res = await post({ text: '' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    expect(llmState.generate).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 400 for a whitespace-only text field', async () => {
    const res = await post({ text: '   \n\t  ' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    expect(llmState.generate).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('answers 400 for text over the request bound', async () => {
    const res = await post({ text: 'a'.repeat(MAX_DRAFT_TEXT_CHARACTERS + 1) })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'invalid_body' } })
    expect(llmState.generate).not.toHaveBeenCalled()
    expect(auditState.writes).toEqual([])
  })

  it('refuses the sixth request in a minute from one caller with 429', async () => {
    echoAsSingleTurn()
    const CALLER = '203.0.113.55'

    let limited: Response | undefined
    for (let attempt = 0; attempt <= 5; attempt += 1) {
      const response = await post({ text: 'doctor how are you feeling' }, CALLER)
      if (response.status === 429) {
        limited = response
        break
      }
    }

    expect(limited?.status, 'a sixth request in the window must be refused').toBe(429)
    await expect(limited?.json()).resolves.toMatchObject({ error: { code: 'rate_limited' } })
    expect(auditActions()).toEqual(Array(5).fill('asr.hosted_draft_labelled'))
  }, 20_000)
})

describe('the draft pair: egress, audit, respond', () => {
  it('returns 200 with the drafted turns and records the success audit row before responding', async () => {
    echoAsSingleTurn()

    const res = await post({ text: 'doctor how are you feeling patient i have a cough' })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      turns: [{ speaker: 'doctor', text: 'doctor how are you feeling patient i have a cough' }],
    })

    expect(llmState.generate).toHaveBeenCalledTimes(1)
    expect(llmState.generate.mock.calls[0]?.[0]).toMatchObject({
      operation: 'draft_turns',
      schemaName: 'draft_turns',
      temperature: 0,
      maxTokens: 16_384,
    })

    expect(auditState.writes).toHaveLength(1)
    expect(auditState.writes[0]?.data).toMatchObject({
      action: 'asr.hosted_draft_labelled',
      actorId: 'doctor-1',
      metadata: { turnCount: 1, detected: [], model: 'test-model' },
    })
  })

  it('fails the request when the success audit write fails: no unaudited draft response', async () => {
    echoAsSingleTurn()
    auditState.failNextWrite = true

    const res = await post({ text: 'doctor how are you feeling' })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'internal_error' } })
    expect(auditState.writes).toEqual([])
  })

  it('answers 502 draft_failed and audits reason llm_failed when generate rejects', async () => {
    llmState.generate.mockRejectedValueOnce(new Error('provider offline'))

    const res = await post({ text: 'doctor how are you feeling' })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'draft_failed' } })
    expect(auditActions()).toEqual(['asr.hosted_draft_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({
      actorId: 'doctor-1',
      metadata: { reason: 'llm_failed' },
    })
  })

  it('answers 502 draft_failed and audits reason not_reconstructed for a paraphrased draft', async () => {
    llmState.generate.mockResolvedValueOnce({
      turns: [{ speaker: 'doctor', text: 'This is an entirely different sentence.' }],
    })

    const res = await post({ text: 'doctor how are you feeling' })

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'draft_failed' } })
    expect(auditActions()).toEqual(['asr.hosted_draft_failed'])
    expect(auditState.writes[0]?.data).toMatchObject({
      actorId: 'doctor-1',
      metadata: { reason: 'not_reconstructed' },
    })
  })

  it('answers 500 with no audit row when the egress guard itself fires', async () => {
    llmState.generate.mockImplementation(async () => {
      throw new DeidentificationError('egress blocked')
    })

    const res = await post({ text: 'doctor how are you feeling' })

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'deid_failed' } })
    expect(auditState.writes).toEqual([])
  })
})

describe('content containment (the logger.leak.test.ts pattern)', () => {
  const NAME_MARKER = 'Ahmad bin Ismail'
  const NRIC_MARKER = '850523-14-5677'

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

  it('sends the LLM only pseudonym tokens and rehydrates the original words in the response', async () => {
    echoAsSingleTurn()

    let body: { turns: { speaker: string; text: string }[] } | undefined
    const logs = await withCapturedLogs(async () => {
      const res = await post({
        text: `Please confirm the identity of ${NAME_MARKER} with IC ${NRIC_MARKER} before we begin.`,
      })
      body = DraftTurnsResponseSchema.parse(await res.json())
    })

    // (a) the LLM mock received pseudonym tokens, never the raw identifiers.
    const sentContent = llmState.generate.mock.calls[0]?.[0]?.content ?? ''
    expect(sentContent).toMatch(/\[PATIENT_\d+\]/)
    expect(sentContent).toMatch(/\[NRIC_\d+\]/)
    expect(sentContent).not.toContain(NAME_MARKER)
    expect(sentContent).not.toContain(NRIC_MARKER)

    // (b) the response the doctor sees carries the rehydrated original words.
    expect(body?.turns[0]?.text).toContain(NAME_MARKER)
    expect(body?.turns[0]?.text).toContain(NRIC_MARKER)

    // (c) neither the logs nor the audit metadata ever carry the transcript.
    expect(logs.length).toBeGreaterThan(0)
    expect(logs).toContain('hosted draft turns labelled')
    expect(logs).not.toContain(NAME_MARKER)
    expect(logs).not.toContain(NRIC_MARKER)
    const auditJson = JSON.stringify(auditState.writes)
    expect(auditJson).not.toContain(NAME_MARKER)
    expect(auditJson).not.toContain(NRIC_MARKER)
  })
})
