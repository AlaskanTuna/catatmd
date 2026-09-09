import {
  type ClinicalFactsResponse,
  LlmClinicalFactsSchema,
  LlmOperationalBlockSchema,
  type NoteAndGapsResponse,
} from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deidentify, deidentifyTranscript } from '../deid/index.js'
import { FIXTURES } from '../fixtures/index.js'
import { getLLMClient, LLMResponseError } from '../lib/llm/index.js'
import { analyseNote } from './index.js'

vi.mock('../lib/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/index.js')>()
  return { ...actual, getLLMClient: vi.fn() }
})

interface StubRequest {
  operation: string
}

const stubClient = (generate: (request: StubRequest) => Promise<unknown>) => {
  const spy = vi.fn(generate)
  vi.mocked(getLLMClient).mockReturnValue({
    provider: 'qwen',
    model: 'test-model',
    generate: spy,
  } as never)
  return spy
}

/** Routes by operation, because analyseNote now issues two calls (§19 row 19). */
const stubSplit = (facts: ClinicalFactsResponse, prose: NoteAndGapsResponse) =>
  stubClient(async (request) => (request.operation === 'clinical_facts' ? facts : prose))

const fixtureById = (id: string) => {
  const fixture = FIXTURES.find((f) => f.id === id)
  if (!fixture) throw new Error(`fixture "${id}" not found`)
  return fixture
}

const emptyFacts = () =>
  LlmClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

const blankProse = (): NoteAndGapsResponse => ({
  note: {
    presentingComplaint: '',
    historyOfPresentingComplaint: '',
    pastMedicalHistory: '',
    socialHistory: '',
    familyHistory: '',
    objective: '',
    assessment: '',
    plan: '',
  },
  gaps: [],
})

beforeEach(() => {
  vi.mocked(getLLMClient).mockReset()
})

describe('analyseNote', () => {
  it('returns one canonical categorized note and derives SOAP Subjective from it', async () => {
    const { text: content } = deidentify('Patient: I have been coughing for three days.')
    const medicalRecordNote = {
      presentingComplaint: 'Cough.',
      historyOfPresentingComplaint: 'Three days.',
      pastMedicalHistory: '',
      socialHistory: '',
      familyHistory: 'No relevant family history stated.',
      objective: '',
      assessment: 'Acute cough under review.',
      plan: 'Supportive care.',
    }

    stubSplit(
      { clinicalFacts: emptyFacts(), operational: LlmOperationalBlockSchema.parse({}) },
      { note: medicalRecordNote, gaps: [] },
    )

    const result = await analyseNote(content, content)

    expect(result.medicalRecordNote).toEqual(medicalRecordNote)
    expect(result.note.subjective).toContain('Presenting Complaint\nCough.')
    expect(result.note.subjective).toContain('Family History\nNo relevant family history stated.')
  })

  it('returns the model output unchanged when every PRESENT/DENIED assertion carries real evidence', async () => {
    const fixture = fixtureById('urti-gap-heavy')
    const { text: content } = deidentifyTranscript(fixture.transcript)

    const facts: ClinicalFactsResponse = {
      clinicalFacts: LlmClinicalFactsSchema.parse({
        symptoms: {
          cough: { state: 'PRESENT', value: 'cough', evidence: 'Batuk sudah 3 hari' },
        },
        history: {},
        observations: {},
        examination: {},
      }),
      operational: LlmOperationalBlockSchema.parse({}),
    }

    const prose: NoteAndGapsResponse = {
      note: {
        presentingComplaint: 'Cough and sore throat.',
        historyOfPresentingComplaint: 'Three days.',
        pastMedicalHistory: '',
        socialHistory: '',
        familyHistory: '',
        objective: 'Throat red, tonsils swollen.',
        assessment: 'Findings support a viral upper respiratory illness.',
        plan: 'Symptomatic treatment, 2 days MC.',
      },
      gaps: [],
    }

    stubSplit(facts, prose)

    const result = await analyseNote(content, content)

    expect(result.discardedFieldIds).toEqual([])
    expect(result.clinicalFacts.symptoms.cough.state).toBe('PRESENT')
    expect(result.note.subjective).toContain('Presenting Complaint\nCough and sore throat.')
  })

  describe('the split operation (docs/trd.md §12, §19 row 19)', () => {
    it('issues both halves, so neither the checklist nor the note can be silently dropped', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')
      const spy = stubSplit(
        { clinicalFacts: emptyFacts(), operational: LlmOperationalBlockSchema.parse({}) },
        blankProse(),
      )

      await analyseNote(content, content)

      const operations = spy.mock.calls.map(([request]) => request.operation)
      expect(operations).toHaveLength(2)
      expect(operations).toContain('clinical_facts')
      expect(operations).toContain('note_and_gaps')
    })

    it('runs them concurrently, since serialising them would cost the budget the split protects', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')

      let inFlight = 0
      let peak = 0
      stubClient(async (request) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight -= 1
        return request.operation === 'clinical_facts'
          ? { clinicalFacts: emptyFacts(), operational: LlmOperationalBlockSchema.parse({}) }
          : blankProse()
      })

      await analyseNote(content, content)

      expect(peak).toBe(2)
    })

    it('fails the whole analysis when either half fails, rather than handing over a partial note', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')

      for (const failing of ['clinical_facts', 'note_and_gaps'] as const) {
        stubClient(async (request) => {
          if (request.operation === failing) {
            throw new LLMResponseError('Provider response failed schema validation', failing)
          }
          return request.operation === 'clinical_facts'
            ? { clinicalFacts: emptyFacts(), operational: LlmOperationalBlockSchema.parse({}) }
            : blankProse()
        })

        await expect(analyseNote(content, content)).rejects.toBeInstanceOf(LLMResponseError)
      }
    })
  })

  describe('the haemoptysis test (docs/prd.md §10, docs/trd.md §21.1)', () => {
    it('never lets a fabricated haemoptysis negative survive analysis', async () => {
      const fixture = fixtureById('urti-gap-heavy')
      const { text: content } = deidentifyTranscript(fixture.transcript)

      const facts: ClinicalFactsResponse = {
        clinicalFacts: LlmClinicalFactsSchema.parse({
          symptoms: {
            cough: { state: 'PRESENT', value: 'cough', evidence: 'Batuk sudah 3 hari' },
            soreThroat: {
              state: 'PRESENT',
              value: 'sore throat',
              evidence: 'throat also quite sakit',
            },
            fever: { state: 'PRESENT', value: 'fever', evidence: '38.2 degrees' },
            // Reproduces docs/trd.md §21.1: the model asserts a negative for a
            // topic the transcript never raises, with no supporting span.
            haemoptysis: { state: 'DENIED', value: 'no haemoptysis', evidence: '' },
          },
          history: {},
          observations: {},
          examination: {},
        }),
        operational: LlmOperationalBlockSchema.parse({}),
      }

      stubSplit(facts, {
        note: {
          presentingComplaint: 'Cough and sore throat.',
          historyOfPresentingComplaint: 'Three days, fever yesterday.',
          pastMedicalHistory: '',
          socialHistory: '',
          familyHistory: '',
          objective: 'Throat red, tonsils swollen.',
          assessment: 'Findings support a viral upper respiratory illness.',
          plan: 'Symptomatic treatment, 2 days MC.',
        },
        gaps: [],
      })

      const result = await analyseNote(content, content)

      expect(result.clinicalFacts.symptoms.haemoptysis.state).toBe('NOT_ASSESSED')
      expect(result.clinicalFacts.symptoms.haemoptysis.state).not.toBe('DENIED')
      expect(result.discardedFieldIds).toContain('clinicalFacts.symptoms.haemoptysis')
    })
  })

  describe('the diagnosis test (docs/prd.md §10, docs/trd.md §3)', () => {
    it('resolves an inferred diagnosis with no supporting doctor statement to NOT_ASSESSED', async () => {
      const fixture = fixtureById('urti-diagnosis-not-assessed')
      const { text: content } = deidentifyTranscript(fixture.transcript)

      stubSplit(
        {
          clinicalFacts: emptyFacts(),
          operational: LlmOperationalBlockSchema.parse({
            // No verbatim span: the doctor never named a condition in this fixture.
            diagnosis: {
              state: 'PRESENT',
              value: 'viral upper respiratory tract infection',
              evidence: '',
            },
          }),
        },
        blankProse(),
      )

      const result = await analyseNote(content, content)

      expect(result.operational.diagnosis.state).toBe('NOT_ASSESSED')
    })
  })

  describe('malformed model responses', () => {
    it('propagates the adapter error rather than returning a partial result', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')

      stubClient(async () => {
        throw new LLMResponseError('Provider response failed schema validation', 'note_and_gaps')
      })

      await expect(analyseNote(content, content)).rejects.toBeInstanceOf(LLMResponseError)
    })
  })

  /*
   * Issue #340. The route used to wrap this whole function in one
   * `note_generation` stage, so a timeout logged that name and nothing said
   * which of the two concurrent calls had actually run long. Both are timed
   * here now, which is the only place that can tell them apart.
   */
  describe('the two calls are timed apart', () => {
    function captureLogLines(): { lines: string[]; restore: () => void } {
      const lines: string[] = []
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          lines.push(String(chunk))
          return true
        })
      return { lines, restore: () => spy.mockRestore() }
    }

    const stagesIn = (lines: readonly string[]) =>
      lines
        .join('')
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as { stage?: string })
        .flatMap((record) => (record.stage === undefined ? [] : [record.stage]))

    it('names each call as its own stage on success', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')
      stubSplit(
        { clinicalFacts: emptyFacts(), operational: LlmOperationalBlockSchema.parse({}) },
        blankProse(),
      )

      const { lines, restore } = captureLogLines()
      try {
        await analyseNote(content, content)
      } finally {
        restore()
      }

      expect(stagesIn(lines).sort()).toEqual(['extraction', 'note_generation'])
    })

    it('names the failing call, not the pair', async () => {
      const { text: content } = deidentify('Doctor: what brings you in today?')
      stubClient(async (request) => {
        if (request.operation === 'clinical_facts') {
          throw new LLMResponseError('Provider response failed schema validation', 'clinical_facts')
        }
        return blankProse()
      })

      const { lines, restore } = captureLogLines()
      try {
        await expect(analyseNote(content, content)).rejects.toBeInstanceOf(LLMResponseError)
      } finally {
        restore()
      }

      const failed = lines
        .join('')
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as { msg?: string; stage?: string })
        .filter((record) => record.msg === 'pipeline stage failed')

      expect(failed.map((record) => record.stage)).toEqual(['extraction'])
    })
  })
})
