import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ClinicalAssertionSchema,
  ClinicalFactsSchema,
  ConsultationDetailSchema,
  ErrorEnvelopeSchema,
  GuidelineChunkSchema,
  LlmClinicalAssertionSchema,
  LlmClinicalFactsSchema,
  makeSuggestionsAndRedFlagsSchema,
  NoteAndGapsResponseSchema,
  OperationalBlockSchema,
  TranscriptSchema,
  TranscriptSourceSchema,
} from './index.js'

describe('ClinicalAssertionSchema', () => {
  it('rejects PRESENT without evidence', () => {
    expect(ClinicalAssertionSchema.safeParse({ state: 'PRESENT', value: 'cough' }).success).toBe(
      false,
    )
  })

  it('rejects DENIED without evidence', () => {
    expect(ClinicalAssertionSchema.safeParse({ state: 'DENIED', value: 'fever' }).success).toBe(
      false,
    )
  })

  it('rejects PRESENT whose evidence is whitespace only', () => {
    const result = ClinicalAssertionSchema.safeParse({
      state: 'PRESENT',
      value: 'cough',
      evidence: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('accepts PRESENT with evidence', () => {
    const result = ClinicalAssertionSchema.safeParse({
      state: 'PRESENT',
      value: 'cough',
      evidence: 'batuk sudah 3 hari',
    })
    expect(result.success).toBe(true)
  })

  it('accepts NOT_ASSESSED with neither value nor evidence', () => {
    const result = ClinicalAssertionSchema.safeParse({ state: 'NOT_ASSESSED' })
    expect(result.success).toBe(true)
  })

  it('accepts UNKNOWN, NOT_APPLICABLE and CLINICIAN_OBSERVED without evidence', () => {
    for (const state of ['UNKNOWN', 'NOT_APPLICABLE', 'CLINICIAN_OBSERVED'] as const) {
      expect(ClinicalAssertionSchema.safeParse({ state }).success).toBe(true)
    }
  })

  it('permits a normalised value against a verbatim evidence span (TRD §21.4)', () => {
    const result = ClinicalAssertionSchema.safeParse({
      state: 'PRESENT',
      value: 'pharyngeal discomfort',
      evidence: 'my throat feels scratchy',
    })
    expect(result.success).toBe(true)
  })
})

describe('the decoding schema is permissive, the persistence schema is strict', () => {
  it('lets the model return an evidence-less DENIED, so one bad fact cannot fail the whole run', () => {
    // Measured against qwen-flash 13/08/26: it emits exactly this shape.
    const emitted = { state: 'DENIED', value: 'no fever' }
    expect(LlmClinicalAssertionSchema.safeParse(emitted).success).toBe(true)
    expect(ClinicalAssertionSchema.safeParse(emitted).success).toBe(false)
  })

  it('accepts a whole model response whose assertions carry no spans', () => {
    const result = NoteAndGapsResponseSchema.safeParse({
      note: { subjective: 'Cough 3 days.', objective: '', assessment: '', plan: '' },
      clinicalFacts: {
        symptoms: { fever: { state: 'DENIED', value: 'no fever' } },
        history: {},
        observations: {},
        examination: {},
      },
      operational: {},
      gaps: [],
    })
    expect(result.success).toBe(true)
  })

  it('keeps one key list across both schemas so they cannot drift', () => {
    const strict = ClinicalFactsSchema.parse({
      symptoms: {},
      history: {},
      observations: {},
      examination: {},
    })
    const permissive = LlmClinicalFactsSchema.parse({
      symptoms: {},
      history: {},
      observations: {},
      examination: {},
    })
    expect(Object.keys(strict.symptoms)).toEqual(Object.keys(permissive.symptoms))
    expect(Object.keys(strict.examination)).toEqual(Object.keys(permissive.examination))
  })
})

describe('NOT_ASSESSED is the cheapest path', () => {
  it('makes a bare NOT_ASSESSED a complete clinical fact set', () => {
    const result = ClinicalFactsSchema.safeParse({
      symptoms: {},
      history: {},
      observations: {},
      examination: {},
    })
    expect(result.success).toBe(true)
    expect(result.data?.symptoms.haemoptysis.state).toBe('NOT_ASSESSED')
  })

  it('defaults every operational-block field to NOT_ASSESSED', () => {
    const result = OperationalBlockSchema.safeParse({})
    expect(result.success).toBe(true)
    expect(result.data?.diagnosis.state).toBe('NOT_ASSESSED')
    expect(result.data?.medicationsDispensed).toEqual([])
  })

  it('never omits a checklist key, so an untouched field cannot read as absent', () => {
    const parsed = ClinicalFactsSchema.parse({
      symptoms: {},
      history: {},
      observations: {},
      examination: {},
    })
    expect(Object.keys(parsed.symptoms)).toContain('haemoptysis')
    expect(Object.keys(parsed.observations)).toContain('oxygenSaturation')
  })
})

describe('Transcript.source', () => {
  it('accepts every specified provenance value', () => {
    for (const source of ['fixture', 'paste', 'upload', 'asr_local', 'asr_hosted'] as const) {
      expect(TranscriptSourceSchema.safeParse(source).success).toBe(true)
    }
  })

  it('requires source on a transcript', () => {
    const result = TranscriptSchema.safeParse({
      turns: [{ speaker: 'doctor', text: 'What brings you in?' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a transcript carrying its source', () => {
    const result = TranscriptSchema.safeParse({
      source: 'fixture',
      turns: [{ speaker: 'doctor', text: 'What brings you in?' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('makeSuggestionsAndRedFlagsSchema', () => {
  const schema = makeSuggestionsAndRedFlagsSchema(['MY-NAG-2024-A10', 'MY-DELPHI-2024-MCISAAC'])

  it('rejects a citation naming an id outside the corpus', () => {
    const result = schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'Consider a throat swab.',
          citations: [{ guidelineId: 'NICE-NG84' }],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a citation naming a corpus id', () => {
    const result = schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [
        {
          id: 's1',
          text: 'Consider a throat swab.',
          citations: [{ guidelineId: 'MY-NAG-2024-A10' }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a suggestion with zero citations', () => {
    const result = schema.safeParse({
      outOfScope: false,
      redFlags: [],
      suggestions: [{ id: 's1', text: 'Consider a throat swab.', citations: [] }],
    })
    expect(result.success).toBe(false)
  })

  it('forces every model-sourced red flag to source: model, with no ruleId', () => {
    const result = schema.safeParse({
      outOfScope: false,
      redFlags: [
        {
          id: 'm1',
          label: 'Possible peritonsillar abscess',
          severity: 'urgent',
          evidence: 'cannot open mouth fully',
          source: 'rule',
          ruleId: 'RF-001',
        },
      ],
      suggestions: [],
    })
    expect(result.success).toBe(false)
  })

  it('allows an empty suggestions array for an out-of-scope presentation', () => {
    const result = schema.safeParse({ outOfScope: true, redFlags: [], suggestions: [] })
    expect(result.success).toBe(true)
  })
})

describe('LLM-facing schemas convert to JSON Schema for constrained decoding', () => {
  it('converts note_and_gaps without throwing (TRD §6 step 2)', () => {
    const json = z.toJSONSchema(NoteAndGapsResponseSchema, { target: 'draft-7' })
    expect(json).toHaveProperty('properties.operational')
    expect(json).toHaveProperty('properties.clinicalFacts')
  })

  it('converts suggestions_and_red_flags with the corpus enum intact', () => {
    const json = z.toJSONSchema(makeSuggestionsAndRedFlagsSchema(['A', 'B']), {
      target: 'draft-7',
    })
    expect(JSON.stringify(json)).toContain('"enum":["A","B"]')
  })
})

describe('API envelope schemas', () => {
  it('resolves ConsultationDetailSchema forward references from TRD §3', () => {
    const result = ConsultationDetailSchema.safeParse({
      id: 'c1',
      status: 'awaiting_review',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      transcript: null,
      analysis: null,
      editedNote: null,
      approvedAt: null,
      acknowledgedRedFlagIds: [],
      reviewedGapIds: [],
    })
    expect(result.success).toBe(true)
  })

  it('shapes every error the same way', () => {
    expect(
      ErrorEnvelopeSchema.safeParse({ error: { code: 'CONFLICT', message: 'Already approved' } })
        .success,
    ).toBe(true)
  })

  it('rejects a guideline chunk that quotes a source forbidding verbatim reuse', () => {
    const result = GuidelineChunkSchema.safeParse({
      id: 'MY-NAG-2024-A10',
      title: 'Acute pharyngitis',
      publisher: 'Ministry of Health Malaysia',
      year: 2024,
      url: 'https://example.gov.my/nag',
      summary: 'Modified Centor scoring for acute pharyngitis.',
      sourceLicence: 'MOH-ARR',
      verbatimAllowed: false,
      quote: 'Antibiotics are indicated at a score of 3 or more.',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a quote on a chunk whose licence permits it', () => {
    const result = GuidelineChunkSchema.safeParse({
      id: 'MY-OOI-2022-URTI',
      title: 'URTI in Malaysian primary care',
      publisher: 'Malaysian Family Physician',
      year: 2022,
      url: 'https://example.org/ooi2022',
      summary: 'Malaysian URTI epidemiology.',
      sourceLicence: 'CC-BY-4.0',
      verbatimAllowed: true,
      quote: 'Respiratory complaints account for 26.8% of primary care problems.',
    })
    expect(result.success).toBe(true)
  })
})
