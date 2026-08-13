import { LlmClinicalFactsSchema, LlmOperationalBlockSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { applyEvidenceCheck } from './evidence.js'

const TRANSCRIPT_TEXT = 'Doctor: Any fever?\nPatient: No fever, but I do have a cough for 3 days.'

const bareFacts = (overrides: Record<string, unknown> = {}) =>
  LlmClinicalFactsSchema.parse({
    symptoms: {},
    history: {},
    observations: {},
    examination: {},
    ...overrides,
  })

const bareOperational = (overrides: Record<string, unknown> = {}) =>
  LlmOperationalBlockSchema.parse(overrides)

describe('applyEvidenceCheck (docs/trd.md §21.4)', () => {
  it('downgrades a DENIED assertion carrying no evidence span to NOT_ASSESSED', () => {
    const facts = bareFacts({
      symptoms: { fever: { state: 'DENIED', value: 'no fever', evidence: '' } },
    })

    const { clinicalFacts, discardedFieldIds } = applyEvidenceCheck(
      facts,
      bareOperational(),
      TRANSCRIPT_TEXT,
    )

    expect(clinicalFacts.symptoms.fever.state).toBe('NOT_ASSESSED')
    expect(clinicalFacts.symptoms.fever.state).not.toBe('DENIED')
    expect(discardedFieldIds).toContain('clinicalFacts.symptoms.fever')
  })

  it('downgrades an assertion whose evidence span is fabricated, not present in the transcript', () => {
    const facts = bareFacts({
      symptoms: {
        haemoptysis: {
          state: 'DENIED',
          value: 'no haemoptysis',
          evidence: 'denies coughing up blood',
        },
      },
    })

    const { clinicalFacts, discardedFieldIds } = applyEvidenceCheck(
      facts,
      bareOperational(),
      TRANSCRIPT_TEXT,
    )

    expect(clinicalFacts.symptoms.haemoptysis.state).toBe('NOT_ASSESSED')
    expect(discardedFieldIds).toContain('clinicalFacts.symptoms.haemoptysis')
  })

  it('keeps a paraphrased value when its evidence span is verbatim in the transcript', () => {
    const facts = bareFacts({
      symptoms: { fever: { state: 'DENIED', value: 'afebrile', evidence: 'No fever' } },
    })

    const { clinicalFacts, discardedFieldIds } = applyEvidenceCheck(
      facts,
      bareOperational(),
      TRANSCRIPT_TEXT,
    )

    expect(clinicalFacts.symptoms.fever.state).toBe('DENIED')
    expect(clinicalFacts.symptoms.fever.value).toBe('afebrile')
    expect(discardedFieldIds).not.toContain('clinicalFacts.symptoms.fever')
  })

  it('resolves every field the model omitted to NOT_ASSESSED, never DENIED', () => {
    const { clinicalFacts, discardedFieldIds } = applyEvidenceCheck(
      bareFacts(),
      bareOperational(),
      TRANSCRIPT_TEXT,
    )

    expect(clinicalFacts.symptoms.haemoptysis.state).toBe('NOT_ASSESSED')
    expect(clinicalFacts.symptoms.haemoptysis.state).not.toBe('DENIED')
    expect(clinicalFacts.observations.oxygenSaturation.state).toBe('NOT_ASSESSED')
    expect(discardedFieldIds).toEqual([])
  })

  it('applies the same rule to the operational block, including medicationsDispensed entries', () => {
    const operational = bareOperational({
      diagnosis: { state: 'PRESENT', value: 'viral URTI', evidence: 'never actually said' },
      medicationsDispensed: [
        { state: 'PRESENT', value: 'Paracetamol', evidence: 'Paracetamol 500mg' },
      ],
    })

    const { operational: checked, discardedFieldIds } = applyEvidenceCheck(
      bareFacts(),
      operational,
      TRANSCRIPT_TEXT,
    )

    expect(checked.diagnosis.state).toBe('NOT_ASSESSED')
    expect(discardedFieldIds).toContain('operational.diagnosis')
    expect(checked.medicationsDispensed[0]?.state).toBe('NOT_ASSESSED')
    expect(discardedFieldIds).toContain('operational.medicationsDispensed[0]')
  })
})
