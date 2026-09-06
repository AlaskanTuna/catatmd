import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

export const MEDICAL_RECORD_TEMPLATE_VERSION = {
  id: 'malaysian-medical-record-v1',
  effectiveDate: '2026-09-07',
} as const satisfies ClinicalArtefactVersion
