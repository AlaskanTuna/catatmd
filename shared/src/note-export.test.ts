import { describe, expect, it } from 'vitest'
import type { OperationalBlock, SoapNote } from './index.js'
import {
  formatEncounterSummary,
  formatSoapNoteForClipboard,
  formatSoapSectionForClipboard,
} from './note-export.js'

const NOTE: SoapNote = {
  subjective: 'Cough for three days.',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care and safety-net advice.',
}

describe('formatSoapSectionForClipboard', () => {
  it('returns section body without a heading', () => {
    expect(formatSoapSectionForClipboard('subjective', NOTE)).toBe('Cough for three days.')
    expect(formatSoapSectionForClipboard('plan', NOTE)).toBe(
      'Supportive care and safety-net advice.',
    )
  })
})

describe('formatSoapNoteForClipboard', () => {
  it('formats all SOAP sections with headings', () => {
    expect(formatSoapNoteForClipboard(NOTE)).toBe(
      'Subjective\nCough for three days.\n\n' +
        'Objective\nTemperature 37.2°C.\n\n' +
        'Assessment\nAcute cough under review.\n\n' +
        'Plan\nSupportive care and safety-net advice.',
    )
  })
})

describe('formatEncounterSummary', () => {
  const emptyOperational = (): OperationalBlock => ({
    diagnosis: { state: 'NOT_ASSESSED' },
    medicationsDispensed: [],
    mcDays: { state: 'NOT_ASSESSED' },
    referral: { state: 'NOT_ASSESSED' },
    followUp: { state: 'NOT_ASSESSED' },
  })

  it('returns an empty string when nothing is documented', () => {
    expect(formatEncounterSummary(emptyOperational())).toBe('')
  })

  it('joins documented operational fields in payer-facing order', () => {
    expect(
      formatEncounterSummary({
        ...emptyOperational(),
        diagnosis: { state: 'PRESENT', value: 'URTI' },
        medicationsDispensed: [{ state: 'PRESENT', value: 'PCM QID' }],
        mcDays: { state: 'PRESENT', value: 'MC 2/7' },
      }),
    ).toBe('URTI, PCM QID, MC 2/7')
  })

  it('ignores NOT_ASSESSED and DENIED fields', () => {
    expect(
      formatEncounterSummary({
        ...emptyOperational(),
        diagnosis: { state: 'DENIED', value: 'should not appear' },
        mcDays: { state: 'NOT_ASSESSED' },
      }),
    ).toBe('')
  })

  it('includes clinician-observed values', () => {
    expect(
      formatEncounterSummary({
        ...emptyOperational(),
        followUp: { state: 'CLINICIAN_OBSERVED', value: 'RTC if worse' },
      }),
    ).toBe('RTC if worse')
  })
})
