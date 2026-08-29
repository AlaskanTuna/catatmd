import { describe, expect, it } from 'vitest'
import {
  RECORD_SECTION_LABELS,
  RECORD_SECTION_ORDER,
  recordSectionForFieldId,
} from './record-sections.js'

describe('recordSectionForFieldId', () => {
  it('maps presenting complaints to PC', () => {
    expect(recordSectionForFieldId('clinicalFacts.symptoms.cough')).toBe('PC')
    expect(recordSectionForFieldId('clinicalFacts.symptoms.soreThroat')).toBe('PC')
  })

  it('maps symptom refinements to HPC', () => {
    expect(recordSectionForFieldId('clinicalFacts.symptoms.coughDuration')).toBe('HPC')
    expect(recordSectionForFieldId('clinicalFacts.symptoms.haemoptysis')).toBe('HPC')
  })

  it('maps comorbidity and medication history to PMH', () => {
    expect(recordSectionForFieldId('clinicalFacts.history.asthma')).toBe('PMH')
    expect(recordSectionForFieldId('clinicalFacts.history.drugAllergies')).toBe('PMH')
  })

  it('maps smoking and exposure to SH', () => {
    expect(recordSectionForFieldId('clinicalFacts.history.smoking')).toBe('SH')
    expect(recordSectionForFieldId('clinicalFacts.history.recentInfectionExposure')).toBe('SH')
  })

  it('maps vitals and examination to O/E', () => {
    expect(recordSectionForFieldId('clinicalFacts.observations.temperature')).toBe('OE')
    expect(recordSectionForFieldId('clinicalFacts.examination.throat')).toBe('OE')
  })

  it('maps operational fields to OPERATIONAL', () => {
    expect(recordSectionForFieldId('operational.diagnosis')).toBe('OPERATIONAL')
    expect(recordSectionForFieldId('operational.mcDays')).toBe('OPERATIONAL')
  })
})

describe('RECORD_SECTION_ORDER', () => {
  it('lists every section with a display label', () => {
    for (const section of RECORD_SECTION_ORDER) {
      expect(RECORD_SECTION_LABELS[section].length).toBeGreaterThan(0)
    }
  })
})
