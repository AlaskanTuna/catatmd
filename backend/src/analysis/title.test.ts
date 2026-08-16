import { ClinicalFactsSchema } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { deriveConsultationTitle } from './title.js'

/** Every key defaults to NOT_ASSESSED, so a case only states what it changes. */
const facts = (symptoms: Record<string, { state: string; value?: string; evidence?: string }>) =>
  ClinicalFactsSchema.parse({
    symptoms,
    history: {},
    observations: {},
    examination: {},
  })

describe('the derived consultation title', () => {
  it('names the findings that are present, in contract order', () => {
    const title = deriveConsultationTitle(
      facts({
        soreThroat: { state: 'PRESENT', value: 'sore throat', evidence: 'my throat hurts' },
        cough: { state: 'PRESENT', value: 'dry cough', evidence: 'been coughing' },
      }),
    )
    // `cough` is declared before `soreThroat` in `ClinicalFactsSchema`, and the
    // order comes from there rather than from the order they were passed in.
    expect(title).toBe('Cough, sore throat')
  })

  it('counts a clinician observation as present', () => {
    expect(
      deriveConsultationTitle(
        facts({ fever: { state: 'CLINICIAN_OBSERVED', value: '38.4', evidence: 'temp 38.4' } }),
      ),
    ).toBe('Fever')
  })

  it('is null when nothing is present, so the UI falls back to the timestamp', () => {
    expect(deriveConsultationTitle(facts({}))).toBeNull()
    expect(
      deriveConsultationTitle(
        facts({ cough: { state: 'DENIED', value: 'no cough', evidence: 'not coughing' } }),
      ),
    ).toBeNull()
  })

  it('never reports a denial as a finding', () => {
    const title = deriveConsultationTitle(
      facts({
        cough: { state: 'PRESENT', value: 'cough', evidence: 'coughing' },
        haemoptysis: { state: 'DENIED', value: 'no blood', evidence: 'no blood' },
      }),
    )
    expect(title).toBe('Cough')
    expect(title).not.toMatch(/haemoptysis/i)
  })

  /*
   * The property that keeps this out of the PHI conversation. A title built
   * from contract key names cannot contain a word the patient or the doctor
   * said, however alarming the transcript is, because no assertion `value` or
   * `evidence` is ever read.
   */
  it('carries no transcript text, only contract field names', () => {
    const title = deriveConsultationTitle(
      facts({
        cough: {
          state: 'PRESENT',
          value: 'Ahmad bin Ismail has a cough',
          evidence: 'Ahmad bin Ismail, 880101-14-5501, has a cough',
        },
      }),
    )
    expect(title).toBe('Cough')
    expect(title).not.toMatch(/Ahmad|880101/)
  })

  it('stops at three, so a row stays scannable', () => {
    const title = deriveConsultationTitle(
      facts({
        cough: { state: 'PRESENT', value: 'a', evidence: 'a' },
        soreThroat: { state: 'PRESENT', value: 'b', evidence: 'b' },
        fever: { state: 'PRESENT', value: 'c', evidence: 'c' },
        dyspnoea: { state: 'PRESENT', value: 'd', evidence: 'd' },
        chestPain: { state: 'PRESENT', value: 'e', evidence: 'e' },
      }),
    )
    expect(title?.split(', ')).toHaveLength(3)
  })

  /*
   * The reason a model does not write this. `operational.diagnosis` is the one
   * field that could turn a filing label into a clinical assertion, and this
   * function cannot reach it: its whole input is `clinicalFacts`.
   */
  it('cannot state a diagnosis, because it never reads the operational block', () => {
    const source = deriveConsultationTitle.toString()
    expect(source).not.toMatch(/diagnosis|operational/i)
  })
})
