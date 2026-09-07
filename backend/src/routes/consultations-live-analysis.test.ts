import type { Server } from 'node:http'
import { LiveAnalysisResponseSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests for the model-backed live panes (#219).
 *
 * Four properties are pinned here, each one a thing that would be invisible in
 * review if it broke: the model is handed **only the new window**, the window
 * is de-identified before it goes and rehydrated before it comes back, an
 * established finding survives a window that does not mention it, and the
 * missing-information list is derived rather than asked for.
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

/** Records exactly what the model was handed, which is the contract under test. */
const llm = vi.hoisted(() => ({
  calls: [] as { operation: string; content: string; system: string }[],
  /**
   * Symptom assertions the stubbed model returns, over an all-NOT_ASSESSED
   * base. A function, because a faithful stub can only quote spans from the
   * text it was actually given: it reads the **de-identified** window, so
   * evidence naming a raw patient name would be discarded by the evidence
   * check, exactly as a hallucinated span is.
   */
  symptoms: (() => ({}) as Record<string, unknown>) as (content: string) => Record<string, unknown>,
  throwNext: false,
}))

/** The turn text of the last line, which is a valid verbatim span for one turn. */
const lastTurnText = (content: string): string => {
  const line = content.trim().split('\n').at(-1) ?? ''
  return line.slice(line.indexOf(':') + 1).trim()
}

vi.mock('../lib/llm/index.js', async () => {
  const { LLMResponseError } = await import('../lib/llm/types.js')
  const { ClinicalFactsResponseSchema } = await import('@shared/types')
  return {
    LLMResponseError,
    getLLMDescriptor: () => ({ provider: 'qwen', model: 'qwen3.7-flash' }),
    getLLMClient: () => ({
      generate: async (request: { operation: string; content: string; system: string }) => {
        llm.calls.push({
          operation: request.operation,
          content: String(request.content),
          system: request.system,
        })
        if (llm.throwNext) {
          llm.throwNext = false
          throw new Error('provider unavailable')
        }
        // Parsed through the real schema, exactly as the adapter does, so the
        // stub cannot hand the route a shape the provider never could.
        return ClinicalFactsResponseSchema.parse({
          clinicalFacts: {
            symptoms: llm.symptoms(String(request.content)),
            history: {},
            observations: {},
            examination: {},
          },
          operational: {},
        })
      },
    }),
  }
})

let server: Server
let origin: string
const realFetch = globalThis.fetch

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
  sessionState.doctorId = 'doctor-1'
  db.owner = 'doctor-1'
  db.auditWrites.length = 0
  db.consultationUpdates.length = 0
  llm.calls.length = 0
  llm.symptoms = () => ({})
  llm.throwNext = false
})

type Turn = { speaker: 'doctor' | 'patient'; text: string }
type Body = { delta: unknown; previous: unknown; profileId?: string }

const window_ = (turns: Turn[]) => ({ source: 'asr_live', labelsReviewed: false, turns })

const post = async (body: Body, id = 'consultation-1') =>
  realFetch(`${origin}/api/consultations/${id}/live-analysis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const actions = () => db.auditWrites.map((write) => write.data.action)

describe('POST /api/consultations/:id/live-analysis', () => {
  it('returns a folded state, derived gaps and the discarded ids', async () => {
    const response = await post({
      delta: window_([{ speaker: 'patient', text: 'I have had a cough for three days.' }]),
      previous: null,
    })
    expect(response.status).toBe(200)

    const parsed = LiveAnalysisResponseSchema.safeParse(await response.json())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.state.cycle).toBe(1)
    // Derived from the merged facts by `deriveGaps`, never asked of the model.
    expect(parsed.success && parsed.data.gaps.length).toBeGreaterThan(0)
  })

  it('hands the model the new window and nothing else', async () => {
    // The fold contract, pinned. `previous` carries settled facts, never text,
    // so an earlier window's words must not reappear in the prompt.
    await post({
      delta: window_([{ speaker: 'patient', text: 'The fever started last night.' }]),
      previous: {
        cycle: 3,
        clinicalFacts: { symptoms: {}, history: {}, observations: {}, examination: {} },
        operational: {},
      },
    })

    const sent = llm.calls.at(-1)
    expect(sent?.operation).toBe('live_facts')
    expect(sent?.content).toContain('fever started last night')
    expect(sent?.content).not.toContain('cough for three days')
  })

  it('de-identifies the window before it leaves and rehydrates what comes back', async () => {
    llm.symptoms = (content) => ({
      cough: { state: 'PRESENT', value: 'three days', evidence: lastTurnText(content) },
    })

    const response = await post({
      delta: window_([{ speaker: 'doctor', text: 'Encik Rahman has a cough.' }]),
      previous: null,
    })

    // Tokenised on the way out.
    const sent = llm.calls.at(-1)
    expect(sent?.content).not.toContain('Rahman')
    expect(sent?.content).toContain('[PATIENT_')

    // Whole again on the way back, so the doctor never reads a token.
    const body = (await response.json()) as {
      state: { clinicalFacts: { symptoms: { cough: { evidence?: string } } } }
    }
    expect(body.state.clinicalFacts.symptoms.cough.evidence).toContain('Rahman')
  })

  it('keeps a finding the next window does not mention', async () => {
    const previous = {
      cycle: 1,
      clinicalFacts: {
        symptoms: {
          cough: { state: 'PRESENT', value: 'three days', evidence: 'cough for three days' },
        },
        history: {},
        observations: {},
        examination: {},
      },
      operational: {},
    }

    // The stubbed model returns an all-NOT_ASSESSED window.
    const response = await post({
      delta: window_([{ speaker: 'patient', text: 'Nothing else really.' }]),
      previous,
    })

    const body = (await response.json()) as {
      state: { cycle: number; clinicalFacts: { symptoms: { cough: { state: string } } } }
    }
    expect(body.state.clinicalFacts.symptoms.cough.state).toBe('PRESENT')
    expect(body.state.cycle).toBe(2)
  })

  it('audits the session once, on the cycle that opens it', async () => {
    await post({
      delta: window_([{ speaker: 'patient', text: 'A cough.' }]),
      previous: null,
    })
    expect(actions()).toEqual(['consultation.live_analysis_started'])

    db.auditWrites.length = 0
    await post({
      delta: window_([{ speaker: 'patient', text: 'And a fever.' }]),
      previous: {
        cycle: 1,
        clinicalFacts: { symptoms: {}, history: {}, observations: {}, examination: {} },
        operational: {},
      },
    })
    // Session-scoped by design: ~100 chained appends per consultation would
    // exhaust the audit chain's head-race retries. See audit/index.ts.
    expect(actions()).toEqual([])
  })

  it('records a failure and answers 500 without leaking the reason', async () => {
    llm.throwNext = true
    const response = await post({
      delta: window_([{ speaker: 'patient', text: 'A cough.' }]),
      previous: null,
    })

    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('analysis_failed')
    expect(body.error.message).not.toContain('provider unavailable')
    expect(actions()).toContain('consultation.live_analysis_failed')
  })

  it('persists nothing', async () => {
    await post({
      delta: window_([{ speaker: 'patient', text: 'A cough.' }]),
      previous: null,
    })
    // No column written, no status moved. The record's lifecycle belongs to
    // Finish, not to a live cycle.
    expect(db.consultationUpdates).toHaveLength(0)
  })

  it('returns 404, never 403, for another doctor’s consultation', async () => {
    db.owner = 'doctor-2'
    const response = await post({
      delta: window_([{ speaker: 'patient', text: 'A cough.' }]),
      previous: null,
    })
    expect(response.status).toBe(404)
    expect(llm.calls).toHaveLength(0)
  })

  it('refuses a body with no previous field at all', async () => {
    // `previous` is nullable but not optional: omitting it is ambiguous
    // between "opening a session" and "forgot to send state".
    const response = await post({
      delta: window_([{ speaker: 'patient', text: 'A cough.' }]),
    } as unknown as Body)
    expect(response.status).toBe(400)
    expect(llm.calls).toHaveLength(0)
  })
})
