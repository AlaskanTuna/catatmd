import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ClinicalAssertionSchema,
  ClinicalFactsResponseSchema,
  ClinicalFactsSchema,
  ConsultationDetailSchema,
  DraftTurnsRequestSchema,
  DraftTurnsResponseSchema,
  ErrorEnvelopeSchema,
  GuidelineChunkSchema,
  LlmClinicalAssertionSchema,
  LlmClinicalFactsSchema,
  MAX_DRAFT_TEXT_CHARACTERS,
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
  it('requires the model to emit the evidence key, since an optional one was never filled', () => {
    // Measured: with `evidence` optional, 0 of 18 PRESENT/DENIED assertions
    // carried a span. Requiring the key took that to 18 of 18.
    expect(
      LlmClinicalAssertionSchema.safeParse({ state: 'DENIED', value: 'no fever' }).success,
    ).toBe(false)
  })

  it('lets an empty span through decoding, so one bad fact cannot fail the whole run', () => {
    const emitted = { state: 'DENIED', value: 'no fever', evidence: '' }
    expect(LlmClinicalAssertionSchema.safeParse(emitted).success).toBe(true)
    expect(ClinicalAssertionSchema.safeParse(emitted).success).toBe(false)
  })

  it('keeps NOT_ASSESSED the cheapest path — empty strings, no content required', () => {
    const result = LlmClinicalAssertionSchema.safeParse({
      state: 'NOT_ASSESSED',
      value: '',
      evidence: '',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a whole model response whose assertions carry no spans', () => {
    const result = ClinicalFactsResponseSchema.safeParse({
      clinicalFacts: {
        symptoms: { fever: { state: 'DENIED', value: 'no fever', evidence: '' } },
        history: {},
        observations: {},
        examination: {},
      },
      operational: {},
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
  it('converts clinical_facts without throwing (TRD §6 step 2)', () => {
    const json = z.toJSONSchema(ClinicalFactsResponseSchema, { target: 'draft-7' })
    expect(json).toHaveProperty('properties.operational')
    expect(json).toHaveProperty('properties.clinicalFacts')
  })

  /**
   * GitHub issue #96. Gemini expands a bounded array into `maxItems` copies of
   * the item schema before measuring the result against its own schema budget,
   * so this one number decides whether `clinical_facts` is accepted at all.
   * Measured 14/08/26 against the live endpoint: bodiless HTTP 400 at twenty,
   * HTTP 200 at ten and below, with nothing else in the request changed.
   *
   * `note_and_gaps` is deliberately not covered here. It carries `maxItems: 30`
   * and passes, because the budget is per-schema rather than per-keyword and it
   * is 686 bytes against 14,240. Asserting one number across both would force a
   * bound neither schema needs.
   */
  it('keeps every clinical_facts array bound inside the Gemini expansion budget', () => {
    const collectMaxItems = (node: unknown): number[] =>
      typeof node !== 'object' || node === null
        ? []
        : Object.entries(node).flatMap(([key, value]) =>
            key === 'maxItems' && typeof value === 'number' ? [value] : collectMaxItems(value),
          )

    const bounds = collectMaxItems(
      z.toJSONSchema(ClinicalFactsResponseSchema, { target: 'draft-7' }),
    )

    expect(bounds, 'A bound that vanished would pass the loop below vacuously.').not.toHaveLength(0)
    for (const bound of bounds) {
      expect(
        bound,
        'Raising this past ten stops Gemini running the pipeline at all (issue ' +
          '#96), and the failure is a bodiless 400 that names no cause. Only the ' +
          'live endpoint can prove a larger value, so re-measure before changing it.',
      ).toBeLessThanOrEqual(10)
    }
  })

  it('converts note_and_gaps without throwing (TRD §6 step 2)', () => {
    const json = z.toJSONSchema(NoteAndGapsResponseSchema, { target: 'draft-7' })
    expect(json).toHaveProperty('properties.note')
    expect(json).toHaveProperty('properties.gaps')
  })

  // The split (§19 row 19) is only worth anything if the two halves stay
  // disjoint: a key drifting back into both would restore the response size
  // the split exists to cut.
  it('keeps the two halves of operation 1 disjoint', () => {
    const facts = z.toJSONSchema(ClinicalFactsResponseSchema, { target: 'draft-7' })
    const prose = z.toJSONSchema(NoteAndGapsResponseSchema, { target: 'draft-7' })
    const keysOf = (json: unknown) =>
      Object.keys((json as { properties: Record<string, unknown> }).properties)

    expect(keysOf(facts).filter((key) => keysOf(prose).includes(key))).toEqual([])
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
      approvedBy: null,
      acknowledgedRedFlagIds: [],
      reviewedGapIds: [],
      redFlagDispositions: [],
      gapDispositions: [],
    })
    expect(result.success).toBe(true)
  })

  // The pair moves together or the contract is lying: a consultation cannot be
  // approved by nobody, and cannot be attributed without having been approved.
  it('carries the approving clinician alongside the approval timestamp', () => {
    const approved = ConsultationDetailSchema.safeParse({
      id: 'c1',
      status: 'approved',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      transcript: null,
      analysis: null,
      editedNote: null,
      approvedAt: '2026-08-13T01:00:00.000Z',
      approvedBy: 'Dr Siti Rahman',
      acknowledgedRedFlagIds: [],
      reviewedGapIds: [],
      redFlagDispositions: [],
      gapDispositions: [],
    })
    expect(approved.success).toBe(true)
    if (approved.success) {
      expect(approved.data.approvedBy).toBe('Dr Siti Rahman')
    }
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

describe('DraftTurnsRequestSchema', () => {
  it('trims surrounding whitespace from text', () => {
    const result = DraftTurnsRequestSchema.safeParse({ text: '  doctor how are you feeling  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.text).toBe('doctor how are you feeling')
    }
  })

  it('rejects an empty text field', () => {
    expect(DraftTurnsRequestSchema.safeParse({ text: '' }).success).toBe(false)
  })

  it('rejects a whitespace-only text field, since trim runs before the length check', () => {
    expect(DraftTurnsRequestSchema.safeParse({ text: '   \n\t  ' }).success).toBe(false)
  })

  it('rejects text over MAX_DRAFT_TEXT_CHARACTERS', () => {
    const result = DraftTurnsRequestSchema.safeParse({
      text: 'a'.repeat(MAX_DRAFT_TEXT_CHARACTERS + 1),
    })
    expect(result.success).toBe(false)
  })

  it('accepts text at the MAX_DRAFT_TEXT_CHARACTERS boundary', () => {
    const result = DraftTurnsRequestSchema.safeParse({
      text: 'a'.repeat(MAX_DRAFT_TEXT_CHARACTERS),
    })
    expect(result.success).toBe(true)
  })
})

describe('DraftTurnsResponseSchema', () => {
  it('rejects a response with zero turns', () => {
    expect(DraftTurnsResponseSchema.safeParse({ turns: [] }).success).toBe(false)
  })

  it('rejects a turn with a speaker outside the closed enum', () => {
    const result = DraftTurnsResponseSchema.safeParse({
      turns: [{ speaker: 'nurse', text: 'How are you feeling?' }],
    })
    expect(result.success).toBe(false)
  })

  it('round-trips a valid payload, and drops no field and adds none', () => {
    const payload = {
      turns: [
        { speaker: 'doctor', text: 'How are you feeling?' },
        { speaker: 'patient', text: 'I have a cough.' },
      ],
    }
    const result = DraftTurnsResponseSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(payload)
    }
  })
})
