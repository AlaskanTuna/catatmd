import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_CLINICAL_VERSIONS } from '../clinical-versions/index.js'

/**
 * The analyse pipeline is mocked at the module seam so these tests exercise the
 * state machine, the red-flag union and rehydration — not the model. The
 * modules themselves are covered by #3/#4/#5 and #6.
 */
vi.mock('../analysis/index.js', () => ({
  analyseNote: vi.fn(async () => ({
    note: {
      subjective: '[PATIENT_1] reports a cough',
      objective: 'Chest clear',
      assessment: 'Likely viral URTI',
      plan: 'Fluids and rest',
    },
    clinicalFacts: {},
    operational: {},
    gaps: [
      {
        id: 'model-gap',
        question: 'Any fever for [PATIENT_1]?',
        rationale: 'Because',
        priority: 'low',
      },
    ],
    discardedFieldIds: ['fever'],
  })),
}))

vi.mock('../gaps/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deriveGaps: vi.fn(() => [
    { id: 'derived-gap', question: 'Duration?', rationale: 'Needed', priority: 'high' },
  ]),
}))

vi.mock('../suggestions/index.js', () => ({
  generateSuggestions: vi.fn(async () => ({
    outOfScope: false,
    redFlags: [
      {
        id: 'model-flag',
        label: 'Model candidate',
        severity: 'advisory',
        evidence: '[PATIENT_1] said so',
        source: 'model',
      },
    ],
    suggestions: [
      { id: 's1', text: 'Advise [PATIENT_1] on fluids', citations: [{ guidelineId: 'g1' }] },
    ],
  })),
}))

vi.mock('../redflags/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  evaluateRedFlags: vi.fn(() => [
    {
      id: 'rule-flag',
      label: 'Rule hit',
      severity: 'emergency',
      evidence: 'stridor',
      source: 'rule',
      ruleId: 'r1',
    },
  ]),
}))

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

const TRANSCRIPT = {
  source: 'paste',
  turns: [{ speaker: 'patient', text: 'I am Ahmad and I have a cough' }],
}

/** Minimal in-memory stand-in for the two tables these routes touch. */
const store = new Map<string, Record<string, unknown>>()
const audits: { action: string; consultationId: string; metadata?: unknown }[] = []

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    consultation: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; doctorId: string } }) => {
        const row = store.get(where.id)
        return row && row.doctorId === where.doctorId ? { ...row } : null
      }),
      findMany: vi.fn(async () => [...store.values()]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'c1',
          createdAt: new Date(),
          updatedAt: new Date(),
          analysis: null,
          editedNote: null,
          approvedAt: null,
          acknowledgedRedFlagIds: null,
          reviewedGapIds: null,
          ...data,
        }
        store.set(row.id as string, row)
        return { ...row }
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...store.get(where.id), ...data, updatedAt: new Date() }
          store.set(where.id, row)
          return { ...row }
        },
      ),
    },
    auditEvent: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; consultationId: string; metadata?: unknown }
        }) => {
          audits.push({
            action: data.action,
            consultationId: data.consultationId,
            metadata: data.metadata,
          })
          return data
        },
      ),
      findMany: vi.fn(async () => []),
    },
  },
}))

let server: Server
let origin: string

beforeAll(async () => {
  const { createApp } = await import('../app.js')
  server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  if (typeof addr === 'string' || addr === null) throw new Error('no port')
  origin = `http://127.0.0.1:${addr.port}`
})

afterAll(() => server.close())

beforeEach(() => {
  store.clear()
  audits.length = 0
})

function seed(status: string, extra: Record<string, unknown> = {}) {
  store.set('c1', {
    id: 'c1',
    doctorId: 'doctor-1',
    status,
    transcript: TRANSCRIPT,
    analysis: null,
    editedNote: null,
    approvedAt: null,
    acknowledgedRedFlagIds: null,
    reviewedGapIds: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  })
}

/** A complete, schema-valid analysis — `toDetail` parses on the way out. */
const AI_NOTE = {
  subjective: 'AI subjective',
  objective: 'AI objective',
  assessment: 'AI assessment',
  plan: 'AI plan',
}
const ANALYSIS = { note: AI_NOTE, gaps: [], redFlags: [], suggestions: [] }

/**
 * Each call presents a distinct client IP. The analyze limiter is per-IP and
 * counts every request including 409s and 404s — correct behaviour, since a
 * cheap rejection is still a request — but it would otherwise bleed across
 * tests and start returning 429 partway through the file.
 */
let clientIp = 0
const call = (method: string, path: string, body?: unknown) =>
  fetch(`${origin}${path}`, {
    method,
    headers: {
      'x-forwarded-for': `198.51.100.${++clientIp % 250}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

describe('state machine — analyze', () => {
  it.each(['draft', 'awaiting_review'])('is allowed from %s', async (status) => {
    seed(status)

    const res = await call('POST', '/api/consultations/c1/analyze')

    expect(res.status).toBe(200)
    expect(store.get('c1')?.status).toBe('awaiting_review')
  })

  it.each(['analyzing', 'approved'])('is refused with 409 from %s', async (status) => {
    seed(status)

    const res = await call('POST', '/api/consultations/c1/analyze')

    expect(res.status).toBe(409)
    expect(store.get('c1')?.status).toBe(status)
  })

  it('reverts status and records a failure category when the pipeline throws', async () => {
    seed('draft')
    const { generateSuggestions } = await import('../suggestions/index.js')
    vi.mocked(generateSuggestions).mockRejectedValueOnce(new Error('transcript: chest pain'))

    const res = await call('POST', '/api/consultations/c1/analyze')

    expect(res.status).toBe(500)
    expect(store.get('c1')?.status).toBe('draft')
    expect(audits.map((a) => a.action)).toContain('consultation.analysis_failed')

    const body = await res.text()
    expect(body).not.toContain('chest pain')
  })
})

describe('analyse output', () => {
  beforeEach(() => seed('draft'))

  async function analysed() {
    const body = (await (await call('POST', '/api/consultations/c1/analyze')).json()) as {
      consultation: {
        analysis: { redFlags: { id: string }[]; gaps: { id: string }[] }
      }
    }
    return body.consultation.analysis
  }

  it('unions rule and model red flags — the model cannot suppress a rule hit', async () => {
    const ids = (await analysed()).redFlags.map((f) => f.id)

    expect(ids).toContain('rule-flag')
    expect(ids).toContain('model-flag')
  })

  it('keeps deterministic gaps alongside model gaps', async () => {
    const ids = (await analysed()).gaps.map((g) => g.id)

    expect(ids).toContain('derived-gap')
    expect(ids).toContain('model-gap')
  })

  it('rehydrates every string field, leaving no vault token in the response', async () => {
    const res = await call('POST', '/api/consultations/c1/analyze')
    const body = await res.text()

    expect(body).not.toMatch(/\[[A-Z]+_\d+\]/)
  })

  it('records version stamps and discarded field ids on completion', async () => {
    await call('POST', '/api/consultations/c1/analyze')

    expect(audits.map((a) => a.action)).toEqual([
      'consultation.analysis_started',
      'consultation.analysis_completed',
    ])

    // Compared against the aggregator itself rather than literal ids, so a
    // version bump does not need this assertion edited, but dropping an
    // artefact from the stamp still fails it (issue #16).
    const completed = audits.find((a) => a.action === 'consultation.analysis_completed')

    expect(completed?.metadata).toMatchObject({
      discardedFieldIds: ['fever'],
      versions: { clinicalContent: ACTIVE_CLINICAL_VERSIONS },
    })
  })
})

describe('state machine — patch', () => {
  it('accepts an edit while awaiting_review', async () => {
    seed('awaiting_review', { analysis: ANALYSIS })

    const res = await call('PATCH', '/api/consultations/c1', {
      editedNote: { plan: 'Revised plan' },
    })

    expect(res.status).toBe(200)
    expect(audits.map((a) => a.action)).toContain('consultation.edited')
  })

  it('seeds a partial first edit from the AI note, so editedNote stays complete', async () => {
    seed('awaiting_review', { analysis: ANALYSIS })

    const res = await call('PATCH', '/api/consultations/c1', {
      editedNote: { plan: 'Revised plan' },
    })
    const { consultation } = (await res.json()) as {
      consultation: { editedNote: Record<string, string> }
    }

    // The one edited field changes; the other three carry over from the AI note
    // rather than persisting a half-note that fails validation on the way out.
    expect(consultation.editedNote).toEqual({
      subjective: 'AI subjective',
      objective: 'AI objective',
      assessment: 'AI assessment',
      plan: 'Revised plan',
    })
  })

  it('refuses an edit when there is no note to edit yet', async () => {
    seed('awaiting_review')

    const res = await call('PATCH', '/api/consultations/c1', { editedNote: { plan: 'x' } })

    expect(res.status).toBe(409)
  })

  it.each(['draft', 'analyzing', 'approved'])(
    'refuses an edit from %s with 409',
    async (status) => {
      seed(status)

      expect(
        (await call('PATCH', '/api/consultations/c1', { editedNote: { plan: 'x' } })).status,
      ).toBe(409)
    },
  )

  it('leaves the original AI analysis untouched when the note is edited', async () => {
    seed('awaiting_review', { analysis: ANALYSIS })

    await call('PATCH', '/api/consultations/c1', { editedNote: { plan: 'Doctor plan' } })

    const stored = store.get('c1') as { analysis: { note: { plan: string } } }
    expect(stored.analysis.note.plan).toBe('AI plan')
    expect(store.get('c1')?.editedNote).toMatchObject({ plan: 'Doctor plan' })
  })

  it('acknowledges red flags additively and audits each one once', async () => {
    seed('awaiting_review', { acknowledgedRedFlagIds: ['rf-1'] })

    await call('PATCH', '/api/consultations/c1', { acknowledgedRedFlagIds: ['rf-1', 'rf-2'] })

    expect(store.get('c1')?.acknowledgedRedFlagIds).toEqual(['rf-1', 'rf-2'])
    expect(audits.filter((a) => a.action === 'redflag.acknowledged')).toHaveLength(1)
  })
})

describe('state machine — approve', () => {
  it('approves from awaiting_review with an analysis attached', async () => {
    seed('awaiting_review', { analysis: ANALYSIS })

    const res = await call('POST', '/api/consultations/c1/approve')

    expect(res.status).toBe(200)
    expect(store.get('c1')?.status).toBe('approved')
    expect(store.get('c1')?.approvedAt).toBeInstanceOf(Date)
    expect(audits.map((a) => a.action)).toContain('consultation.approved')
  })

  it('refuses to approve a consultation with no analysis', async () => {
    seed('awaiting_review')

    expect((await call('POST', '/api/consultations/c1/approve')).status).toBe(409)
    expect(store.get('c1')?.status).toBe('awaiting_review')
  })

  it.each(['draft', 'analyzing', 'approved'])(
    'refuses approval from %s with 409',
    async (status) => {
      seed(status, { analysis: ANALYSIS })

      expect((await call('POST', '/api/consultations/c1/approve')).status).toBe(409)
    },
  )

  it('is terminal — no edit or re-analysis after approval', async () => {
    seed('approved', { analysis: ANALYSIS })

    expect(
      (await call('PATCH', '/api/consultations/c1', { editedNote: { plan: 'x' } })).status,
    ).toBe(409)
    expect((await call('POST', '/api/consultations/c1/analyze')).status).toBe(409)
    expect((await call('POST', '/api/consultations/c1/approve')).status).toBe(409)
  })
})

describe('ownership', () => {
  it.each([
    ['GET', '/api/consultations/c1'],
    ['POST', '/api/consultations/c1/analyze'],
    ['PATCH', '/api/consultations/c1'],
    ['POST', '/api/consultations/c1/approve'],
    ['GET', '/api/consultations/c1/history'],
  ])('%s %s returns 404 for another doctor', async (method, path) => {
    seed('awaiting_review')
    store.set('c1', { ...store.get('c1'), doctorId: 'someone-else' })

    const res = await call(
      method,
      path,
      method === 'PATCH' ? { editedNote: { plan: 'x' } } : undefined,
    )

    expect(res.status).toBe(404)
  })
})
