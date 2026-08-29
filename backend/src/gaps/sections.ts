import type { RecordSection } from '@shared/types'
import { ALL_GAP_CHECKLIST } from './checklist.js'

/**
 * Malaysian GP record section for each deterministic gap id (Task #10).
 *
 * Kept separate from `checklist.ts` so section tagging can be reviewed without
 * rereading every question string.
 */
export const GAP_SECTION_BY_ID: Readonly<Record<string, RecordSection>> = {
  // HPC — history of presenting complaint
  'cough-duration': 'HPC',
  'sputum-production': 'HPC',
  haemoptysis: 'HPC',
  fever: 'HPC',
  dyspnoea: 'HPC',
  'chest-pain': 'HPC',
  'swallowing-difficulty': 'HPC',
  'oral-intake': 'HPC',

  // PMH — past medical history
  asthma: 'PMH',
  copd: 'PMH',
  'cardiac-disease': 'PMH',
  immunosuppression: 'PMH',
  'current-medications': 'PMH',
  'drug-allergies': 'PMH',
  'uti-drug-allergies': 'PMH',

  // SH — social history
  smoking: 'SH',

  // O/E — on examination (vitals and examination findings)
  temperature: 'OE',
  'heart-rate': 'OE',
  'respiratory-rate': 'OE',
  'blood-pressure': 'OE',
  'oxygen-saturation': 'OE',
  'throat-examination': 'OE',
  'tonsillar-examination': 'OE',
  'cervical-lymph-nodes': 'OE',
  'chest-examination': 'OE',
  'uti-temperature': 'OE',
  'uti-heart-rate': 'OE',
  'uti-respiratory-rate': 'OE',
  'uti-blood-pressure': 'OE',

  // Operational — Malaysian payer block
  diagnosis: 'OPERATIONAL',
  'mc-days': 'OPERATIONAL',
  referral: 'OPERATIONAL',
  'follow-up': 'OPERATIONAL',
}

/** Every checklist entry must resolve to a record section. */
export function gapRecordSection(gapId: string): RecordSection {
  const section = GAP_SECTION_BY_ID[gapId]
  if (!section) {
    throw new Error(`No record section mapped for gap id "${gapId}"`)
  }
  return section
}

/** Validates `GAP_SECTION_BY_ID` covers the full checklist at module load. */
for (const entry of ALL_GAP_CHECKLIST) {
  if (!(entry.id in GAP_SECTION_BY_ID)) {
    throw new Error(`Gap checklist entry "${entry.id}" has no record section mapping`)
  }
}
