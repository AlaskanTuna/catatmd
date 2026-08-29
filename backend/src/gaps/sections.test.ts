import { describe, expect, it } from 'vitest'
import { ALL_GAP_CHECKLIST } from './checklist.js'
import { GAP_SECTION_BY_ID, gapRecordSection } from './sections.js'

describe('GAP_SECTION_BY_ID', () => {
  it('covers every checklist entry', () => {
    for (const entry of ALL_GAP_CHECKLIST) {
      expect(GAP_SECTION_BY_ID[entry.id], entry.id).toBeDefined()
    }
  })

  it('resolves known ids through gapRecordSection', () => {
    expect(gapRecordSection('haemoptysis')).toBe('HPC')
    expect(gapRecordSection('drug-allergies')).toBe('PMH')
    expect(gapRecordSection('smoking')).toBe('SH')
    expect(gapRecordSection('oxygen-saturation')).toBe('OE')
    expect(gapRecordSection('diagnosis')).toBe('OPERATIONAL')
  })
})
