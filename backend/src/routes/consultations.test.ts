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
    // Shaped like the real thing: assertions nested under groups, and an array
    // of them under `medicationsDispensed`. `evidence` is a verbatim span from
    // the de-identified transcript, so it carries a vault token by construction.
    clinicalFacts: {
      symptoms: {
        cough: { state: 'PRESENT', value: 'dry cough', evidence: '[PATIENT_1] has a dry cough' },
        haemoptysis: { state: 'NOT_ASSESSED' },
      },
      history: {
        smoking: { state: 'DENIED', value: 'non-smoker', evidence: '[PATIENT_1] does not smoke' },
      },
      // Present but empty: every field carries its own NOT_ASSESSED default, so
      // the groups fill themselves in. The group keys are still required.
      observations: {},
      examination: {},
    },
    operational: {
      diagnosis: { state: 'PRESENT', value: 'URTI', evidence: 'I think [PATIENT_1] has a URTI' },
      medicationsDispensed: [
        { state: 'PRESENT', value: 'paracetamol', evidence: 'giving [PATIENT_1] paracetamol' },
      ],
      mcDays: { state: 'NOT_ASSESSED' },
    },
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

const auditEvent = {
  create: vi.fn(
    async ({
      data,
    }: {
      data: { action: string; consultationId: string; hash: string; metadata?: unknown }
    }) => {
      audits.push({
        action: data.action,
        consultationId: data.consultationId,
        metadata: data.metadata,
      })
      chainHead = data.hash
      return data
    },
  ),
  findMany: vi.fn(async () => []),
  findFirst: vi.fn(async () => (chainHead === null ? null : { hash: chainHead })),
}

let chainHead: string | null = null

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    consultation: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; doctorId: string; erasedAt: null } }) => {
          const row = store.get(where.id)
          return row && row.doctorId === where.doctorId && row.erasedAt === where.erasedAt
            ? { ...row }
            : null
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { doctorId: string; erasedAt: null } }) =>
        [...store.values()].filter(
          (row) => row.doctorId === where.doctorId && row.erasedAt === where.erasedAt,
        ),
      ),
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
          erasedAt: null,
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
    auditEvent,
    // Appends run inside a transaction so the head read and the insert are
    // atomic (issue #27). The stand-in just runs the callback against the same
    // table stub.
    $transaction: vi.fn((run: (tx: { auditEvent: typeof auditEvent }) => unknown) =>
      run({ auditEvent }),
    ),
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
  chainHead = null
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
    erasedAt: null,
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
    type Assertion = { state: string; value?: string; evidence?: string }
    const body = (await (await call('POST', '/api/consultations/c1/analyze')).json()) as {
      consultation: {
        analysis: {
          redFlags: { id: string }[]
          gaps: { id: string }[]
          clinicalFacts?: Record<string, Record<string, Assertion>>
          operational?: Record<string, Assertion> & { medicationsDispensed?: Assertion[] }
        }
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

  /**
   * docs/prd.md §10 requires a field the consultation never touched to read as
   * unestablished rather than absent, and the review screen cannot render a
   * `NOT_ASSESSED` it was never sent. These were computed, fed to `deriveGaps`,
   * and then discarded before this.
   */
  it('persists the reviewed checklist rather than discarding it', async () => {
    const analysis = await analysed()

    expect(analysis.clinicalFacts?.symptoms?.cough?.state).toBe('PRESENT')
    expect(analysis.clinicalFacts?.symptoms?.haemoptysis?.state).toBe('NOT_ASSESSED')
    expect(analysis.operational?.diagnosis?.state).toBe('PRESENT')
  })

  it('rehydrates assertion values and evidence, including inside arrays', async () => {
    const analysis = await analysed()

    // `evidence` is a verbatim span from the de-identified transcript, so it
    // carries a token essentially always. A pseudonym reaching the evidence
    // trail is what the doctor would actually notice.
    expect(analysis.clinicalFacts?.symptoms?.cough?.evidence).toContain('Ahmad')
    expect(analysis.clinicalFacts?.history?.smoking?.evidence).toContain('Ahmad')
    expect(analysis.operational?.diagnosis?.evidence).toContain('Ahmad')
    // The array case a per-field map would silently miss.
    expect(analysis.operational?.medicationsDispensed?.[0]?.evidence).toContain('Ahmad')

    expect(JSON.stringify(analysis)).not.toMatch(/\[[A-Z]+_\d+\]/)
  })

  it('leaves an assertion with no value or evidence untouched', async () => {
    const analysis = await analysed()

    expect(analysis.clinicalFacts?.symptoms?.haemoptysis).toEqual({ state: 'NOT_ASSESSED' })
    expect(analysis.operational?.mcDays).toEqual({ state: 'NOT_ASSESSED' })
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

  it('persists the selected profile id in analysis and completion audit metadata', async () => {
    await call('POST', '/api/consultations/c1/analyze', {
      profileId: 'adult-acute-uncomplicated-uti',
    })

    expect(store.get('c1')?.analysis).toMatchObject({
      profileId: 'adult-acute-uncomplicated-uti',
    })
    expect(
      audits.find((audit) => audit.action === 'consultation.analysis_completed')?.metadata,
    ).toMatchObject({
      profileId: 'adult-acute-uncomplicated-uti',
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

describe('erased consultations', () => {
  it('are absent from the list and return 404 on detail', async () => {
    seed('awaiting_review', { erasedAt: new Date() })

    const list = await call('GET', '/api/consultations')
    const detail = await call('GET', '/api/consultations/c1')

    expect((await list.json()) as { consultations: unknown[] }).toEqual({ consultations: [] })
    expect(detail.status).toBe(404)
  })
})
