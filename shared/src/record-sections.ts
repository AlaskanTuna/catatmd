import { z } from 'zod'

/**
 * Malaysian GP consultation record sections (client meeting 27/08/26, Task #10).
 *
 * Maps the fixed `ClinicalFacts` checklist onto PC / HPC / PMH / SH / O/E rather
 * than the internal symptoms/history/observations/examination grouping. Family
 * history (FH) is not represented: the PRD completeness checklist has no FH
 * field and none is invented here.
 */
export const RecordSectionSchema = z.enum(['PC', 'HPC', 'PMH', 'SH', 'OE', 'OPERATIONAL'])

export type RecordSection = z.infer<typeof RecordSectionSchema>

export const RECORD_SECTION_LABELS: Readonly<Record<RecordSection, string>> = {
  PC: 'Presenting Complaint (PC)',
  HPC: 'History of Presenting Complaint (HPC)',
  PMH: 'Past Medical History (PMH)',
  SH: 'Social History (SH)',
  OE: 'On Examination (O/E)',
  OPERATIONAL: 'Operational',
}

/** Display order for completeness panels. */
export const RECORD_SECTION_ORDER: readonly RecordSection[] = [
  'PC',
  'HPC',
  'PMH',
  'SH',
  'OE',
  'OPERATIONAL',
]

const PC_SYMPTOM_FIELDS = new Set(['cough', 'soreThroat'])

const PMH_HISTORY_FIELDS = new Set([
  'asthma',
  'copd',
  'cardiacDisease',
  'immunosuppression',
  'currentMedications',
  'drugAllergies',
])

const SH_HISTORY_FIELDS = new Set(['smoking', 'recentInfectionExposure'])

/**
 * Resolves a persisted checklist field id (`clinicalFacts.symptoms.cough`, …)
 * to the Malaysian record section it belongs under.
 */
export function recordSectionForFieldId(fieldId: string): RecordSection {
  if (fieldId.startsWith('operational.')) return 'OPERATIONAL'

  const match = /^clinicalFacts\.(\w+)\.(\w+)$/.exec(fieldId)
  if (!match) return 'HPC'

  const group = match[1]
  const field = match[2]
  if (!group || !field) return 'HPC'

  if (group === 'symptoms') {
    return PC_SYMPTOM_FIELDS.has(field) ? 'PC' : 'HPC'
  }
  if (group === 'history') {
    if (PMH_HISTORY_FIELDS.has(field)) return 'PMH'
    if (SH_HISTORY_FIELDS.has(field)) return 'SH'
    return 'PMH'
  }
  if (group === 'observations' || group === 'examination') return 'OE'

  return 'HPC'
}
