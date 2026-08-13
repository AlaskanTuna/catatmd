import {
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

const stubClient = (generate: (...args: unknown[]) => Promise<unknown>) => {
  vi.mocked(getLLMClient).mockReturnValue({
    provider: 'qwen',
    model: 'test-model',
    generate: vi.fn(generate),
  } as never)
}

const fixtureById = (id: string) => {
  const fixture = FIXTURES.find((f) => f.id === id)
  if (!fixture) throw new Error(`fixture "${id}" not found`)
  return fixture
}

const emptyFacts = () =>
  LlmClinicalFactsSchema.parse({ symptoms: {}, history: {}, observations: {}, examination: {} })

beforeEach(() => {
  vi.mocked(getLLMClient).mockReset()
})

describe('analyseNote', () => {
  it('returns the model output unchanged when every PRESENT/DENIED assertion carries real evidence', async () => {
    const fixture = fixtureById('urti-gap-heavy')
    const { text: content } = deidentifyTranscript(fixture.transcript)

    const response: NoteAndGapsResponse = {
      note: {
        subjective: 'Cough 3 days, sore throat.',
        objective: 'Throat red, tonsils swollen.',
        assessment: 'Findings support a viral upper respiratory illness.',
        plan: 'Symptomatic treatment, 2 days MC.',
      },
      clinicalFacts: LlmClinicalFactsSchema.parse({
        symptoms: {
          cough: { state: 'PRESENT', value: 'cough', evidence: 'Batuk sudah 3 hari' },
        },
        history: {},
        observations: {},
        examination: {},
      }),
      operational: LlmOperationalBlockSchema.parse({}),
      gaps: [],
    }

    stubClient(async () => response)

    const result = await analyseNote(content, content)

    expect(result.discardedFieldIds).toEqual([])
    expect(result.clinicalFacts.symptoms.cough.state).toBe('PRESENT')
  })

  describe('the haemoptysis test (docs/prd.md §10, docs/trd.md §21.1)', () => {
    it('never lets a fabricated haemoptysis negative survive analysis', async () => {
      const fixture = fixtureById('urti-gap-heavy')
      const { text: content } = deidentifyTranscript(fixture.transcript)

      const response: NoteAndGapsResponse = {
        note: {
          subjective: 'Cough 3 days, sore throat, fever yesterday.',
          objective: 'Throat red, tonsils swollen.',
          assessment: 'Findings support a viral upper respiratory illness.',
          plan: 'Symptomatic treatment, 2 days MC.',
        },
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
            haemoptysis: { state: 'DENIED', value: 'no haemoptysis' },
          },
          history: {},
          observations: {},
          examination: {},
        }),
        operational: LlmOperationalBlockSchema.parse({}),
        gaps: [],
      }

      stubClient(async () => response)

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

      const response: NoteAndGapsResponse = {
        note: { subjective: '', objective: '', assessment: '', plan: '' },
        clinicalFacts: emptyFacts(),
        operational: LlmOperationalBlockSchema.parse({
          // No verbatim span — the doctor never named a condition in this fixture.
          diagnosis: { state: 'PRESENT', value: 'viral upper respiratory tract infection' },
        }),
        gaps: [],
      }

      stubClient(async () => response)

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
})
