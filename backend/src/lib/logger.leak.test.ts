import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURES } from '../fixtures/index.js'

/**
 * The test that actually holds the line for GitHub issue #15.
 *
 * It runs a real fixture analysis end to end against the real de-identification
 * gate, the real logger and the real middleware, captures everything written to
 * stdout, and asserts that not one identifier, transcript span, note field or
 * vault token appears anywhere in it.
 *
 * The fixture is `urti-identifier-dense-routine`, which exists precisely
 * because it carries a name, NRIC, phone, address, date of birth, clinic
 * registration number and email in a single consultation.
 *
 * Only the two LLM calls are mocked, and they are mocked to behave like the
 * real thing at its most dangerous: echoing vault tokens back and quoting the
 * de-identified transcript verbatim in evidence spans.
 */

const FIXTURE = FIXTURES.find((f) => f.id === 'urti-identifier-dense-routine')
if (!FIXTURE) throw new Error('identifier-dense fixture missing')

vi.mock('../analysis/index.js', () => ({
  analyseNote: vi.fn(async () => ({
    note: {
      subjective: '[PATIENT_1] reports cough and sore throat for two days.',
      objective: 'Temperature 38.9. Chest clear.',
      assessment: 'Acute upper respiratory tract infection.',
      plan: 'Symptomatic relief. Review if worsening.',
    },
    // Now persisted and returned, so it has to satisfy `ClinicalFactsSchema`.
    // `evidence` carries a vault token deliberately: this suite exists to prove
    // none of it reaches the log drain.
    clinicalFacts: {
      symptoms: {
        cough: { state: 'PRESENT', value: 'dry cough', evidence: '[PATIENT_1] has a dry cough' },
      },
      history: {},
      observations: {},
      examination: {},
    },
    operational: {
      diagnosis: { state: 'PRESENT', value: 'URTI', evidence: '[PATIENT_1] likely has a URTI' },
    },
    gaps: [
      {
        id: 'gap-1',
        question: 'Has [PATIENT_1] had any recent travel?',
        rationale: 'Relevant to differential.',
        priority: 'low',
      },
    ],
    discardedFieldIds: [],
  })),
}))

vi.mock('../suggestions/index.js', () => ({
  generateSuggestions: vi.fn(async () => ({
    outOfScope: false,
    redFlags: [],
    suggestions: [
      {
        id: 's1',
        text: 'Advise [PATIENT_1] on fluids and rest.',
        citations: [{ guidelineId: 'moh-nag-2024-urti' }],
      },
    ],
  })),
}))

// Partial: `clinical-versions/` reads `GAP_CHECKLIST_VERSION` from this module,
// so replacing it wholesale breaks the version stamp at import time.
vi.mock('../gaps/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deriveGaps: vi.fn(() => []),
}))

vi.mock('../middleware/require-session.js', () => ({
  requireSession: (req: { doctorId?: string }, _res: unknown, next: () => void) => {
    req.doctorId = 'doctor-1'
    next()
  },
}))

const store = new Map<string, Record<string, unknown>>()

const auditEvent = {
  create: vi.fn(async () => ({})),
  findFirst: vi.fn(async () => null),
}

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    consultation: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; doctorId: string } }) => {
        const row = store.get(where.id)
        return row && row.doctorId === where.doctorId ? { ...row } : null
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
    // Appends run inside a transaction (issue #27); run the callback against
    // the same table stub.
    $transaction: vi.fn((run: (tx: { auditEvent: typeof auditEvent }) => unknown) =>
      run({ auditEvent }),
    ),
  },
}))

let server: Server
let origin: string
let captured: string[] = []

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
  captured = []
  store.set('c1', {
    id: 'c1',
    doctorId: 'doctor-1',
    status: 'draft',
    transcript: FIXTURE.transcript,
    analysis: null,
    editedNote: null,
    approvedAt: null,
    acknowledgedRedFlagIds: null,
    reviewedGapIds: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

async function analyseAndCaptureLogs(): Promise<{ status: number; logs: string }> {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.push(String(chunk))
    return true
  })
  let status = 0
  try {
    status = (await fetch(`${origin}/api/consultations/c1/analyze`, { method: 'POST' })).status
    // The request-completed line is emitted from a `finish` handler, which can
    // land just after fetch resolves.
    await new Promise((r) => setTimeout(r, 50))
  } finally {
    spy.mockRestore()
  }
  return { status, logs: captured.join('') }
}

describe('no clinical content reaches the log drain', () => {
  it('logs a real fixture analysis without leaking anything from it', async () => {
    const { status, logs } = await analyseAndCaptureLogs()

    expect(status).toBe(200)

    // Guards against the test passing vacuously: absence proves nothing if
    // nothing was written.
    expect(logs.length).toBeGreaterThan(0)
    expect(logs).toContain('pipeline stage complete')

    // Every identifier the fixture deliberately carries.
    for (const identifier of [
      'Ahmad',
      'Ismail',
      '850523-14-5677',
      '012-3456789',
      'Jalan Meranti',
      'Kajang',
      'Selangor',
      'ahmad.ismail85@example.com',
      '23 May 1985',
    ]) {
      expect(logs, `identifier leaked: ${identifier}`).not.toContain(identifier)
    }

    // Verbatim transcript spans.
    for (const turn of FIXTURE.transcript.turns) {
      const span = turn.text.slice(0, 40)
      expect(logs, `transcript span leaked: ${span}`).not.toContain(span)
    }

    // Note content produced by the model.
    for (const noteText of [
      'reports cough and sore throat',
      'Temperature 38.9',
      'Acute upper respiratory tract infection',
      'Symptomatic relief',
      'recent travel',
      'fluids and rest',
    ]) {
      expect(logs, `note content leaked: ${noteText}`).not.toContain(noteText)
    }

    // Vault tokens are pseudonyms, not identifiers, but they are the key to the
    // vault and have no business in a log line either.
    expect(logs).not.toMatch(/\[[A-Z]+_\d+\]/)
  })

  it('still records what an on-call engineer actually needs', async () => {
    const { logs } = await analyseAndCaptureLogs()
    const records = logs
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    // A request id on every line, so the whole analysis is one trace.
    expect(records.every((r) => typeof r.requestId === 'string')).toBe(true)
    expect(new Set(records.map((r) => r.requestId)).size).toBe(1)

    // Latency for each stage the issue names.
    const stages = records.filter((r) => r.stage).map((r) => r.stage)
    expect(stages).toEqual(
      expect.arrayContaining(['deidentification', 'rules', 'note_generation', 'retrieval']),
    )
    for (const record of records.filter((r) => r.stage)) {
      expect(typeof record.durationMs).toBe('number')
    }

    // Detector labels and a count, which is the de-identification observability
    // the issue asks for, with no values anywhere.
    const deidRecord = records.find((r) => Array.isArray(r.detectorLabels))
    expect(deidRecord).toBeDefined()
    expect(deidRecord?.detectorCount).toBeGreaterThan(0)
    expect(deidRecord?.detectorLabels).toEqual(
      expect.arrayContaining(['NRIC', 'PATIENT', 'PHONE', 'EMAIL']),
    )
  })

  it('leaks nothing when the pipeline fails, which is when logging is loudest', async () => {
    const { generateSuggestions } = await import('../suggestions/index.js')
    vi.mocked(generateSuggestions).mockRejectedValueOnce(
      // Exactly the shape of a provider error that quotes the payload back.
      new Error(
        'upstream rejected request: {"content":"Encik Ahmad bin Ismail, NRIC 850523-14-5677, batuk 2 days"}',
      ),
    )

    const { status, logs } = await analyseAndCaptureLogs()

    expect(status).toBe(500)
    expect(logs).toContain('pipeline stage failed')
    expect(logs).not.toContain('Ahmad')
    expect(logs).not.toContain('850523-14-5677')
    expect(logs).not.toContain('batuk')
    expect(logs).not.toContain('upstream rejected')
  })

  /**
   * The test above proves the *wired call sites* are clean. That is the weaker
   * property, and on its own it passes even with redaction switched off,
   * because nothing in the pipeline currently hands the logger anything
   * dangerous.
   *
   * This one proves the property that actually matters: the logger refuses
   * clinical content even when a call site hands it over deliberately. It uses
   * the real fixture transcript and the real analysis the pipeline just
   * produced, in the shapes a tired engineer reaches for at 2am.
   */
  it('refuses clinical content even when a call site hands it over directly', async () => {
    await analyseAndCaptureLogs()
    const produced = store.get('c1')?.analysis as {
      note: Record<string, string>
      gaps: { question: string }[]
      suggestions: { text: string }[]
    }
    const { logger } = await import('./logger.js')

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk))
      return true
    })
    captured = []

    // Each cast is what a genuine bypass looks like: `LogFields` rejects these
    // keys at compile time, so reaching the serialiser at all takes an `as`.
    logger.info('debugging', { transcript: FIXTURE.transcript } as never)
    logger.error('analysis failed', { analysis: produced } as never)
    logger.warn('note', { operation: JSON.stringify(FIXTURE.transcript) } as never)
    logger.info('note', { operation: produced.note.subjective } as never)
    logger.info('gap', { operation: produced.gaps[0]?.question ?? '' } as never)
    logger.info('suggestion', { operation: produced.suggestions[0]?.text ?? '' } as never)
    logger.info(`analysing ${FIXTURE.transcript.turns[1]?.text}`)
    logger.info('vault', { operation: '[PATIENT_1] maps to Ahmad bin Ismail' } as never)

    spy.mockRestore()
    const logs = captured.join('')

    expect(logs.length).toBeGreaterThan(0)
    for (const secret of [
      'Ahmad',
      'Ismail',
      '850523-14-5677',
      'ahmad.ismail85@example.com',
      'Jalan Meranti',
      'cough and sore throat',
      'Acute upper respiratory',
      'recent travel',
      'fluids and rest',
      'batuk',
    ]) {
      expect(logs, `leaked via direct call: ${secret}`).not.toContain(secret)
    }
    expect(logs).not.toMatch(/\[[A-Z]+_\d+\]/)
  })

  it('never writes the request body, however the request fails', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk))
      return true
    })
    captured = []
    await fetch(`${origin}/api/consultations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript: { source: 'paste', turns: [{ speaker: 'patient', text: 'not a valid shape' }] },
        stray: 'Encik Ahmad bin Ismail 850523-14-5677',
      }),
    })
    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const logs = captured.join('')
    expect(logs).not.toContain('Ahmad')
    expect(logs).not.toContain('850523-14-5677')
    expect(logs).not.toContain('not a valid shape')
  })
})
