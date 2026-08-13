import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'
import { ALL_GAP_CHECKLIST, type GapChecklistEntry } from '../gaps/index.js'
import { GUIDELINE_CORPUS, type ProfiledGuidelineChunk } from '../guidelines/index.js'
import { ALL_REDFLAG_TRIGGERS, type RedFlagTrigger } from '../redflags/index.js'
import { PROFILE_IDS, type ProfileId } from './types.js'

export { PROFILE_IDS, type ProfileId, ProfileIdSchema } from './types.js'

export interface ClinicalProfile {
  readonly id: ProfileId
  readonly version: ClinicalArtefactVersion
  readonly scope: string
  readonly noteTemplate: string
  readonly redFlagTriggers: readonly RedFlagTrigger[]
  readonly gapChecklist: readonly GapChecklistEntry[]
  readonly guidelineCorpus: readonly ProfiledGuidelineChunk[]
}

export const ADULT_ACUTE_URTI_PROFILE_VERSION: ClinicalArtefactVersion = {
  id: 'adult-acute-urti-profile-v1',
  effectiveDate: '2026-08-14',
}

export const ADULT_ACUTE_UNCOMPLICATED_UTI_PROFILE_VERSION: ClinicalArtefactVersion = {
  id: 'adult-acute-uncomplicated-uti-profile-v1',
  effectiveDate: '2026-08-14',
}

const PROFILE_DEFINITIONS = {
  'adult-acute-urti': {
    version: ADULT_ACUTE_URTI_PROFILE_VERSION,
    scope: 'adult acute cough, sore throat, and other upper-respiratory presentations',
    noteTemplate:
      'Use the SOAP scaffold for the documented respiratory presentation. Record findings and ' +
      'the doctor-stated operational block only.',
  },
  'adult-acute-uncomplicated-uti': {
    version: ADULT_ACUTE_UNCOMPLICATED_UTI_PROFILE_VERSION,
    scope: 'adult acute primary-care presentations with urinary symptoms',
    noteTemplate:
      'Use the SOAP scaffold for the documented urinary presentation. Record findings and the ' +
      'doctor-stated operational block only.',
  },
} as const satisfies Record<
  ProfileId,
  Omit<ClinicalProfile, 'id' | 'redFlagTriggers' | 'gapChecklist' | 'guidelineCorpus'>
>

function selectProfileContent(
  profileId: ProfileId,
): Omit<ClinicalProfile, 'id' | 'version' | 'scope' | 'noteTemplate'> {
  return {
    redFlagTriggers: ALL_REDFLAG_TRIGGERS.filter((trigger) => trigger.profiles.includes(profileId)),
    gapChecklist: ALL_GAP_CHECKLIST.filter((entry) => entry.profiles.includes(profileId)),
    guidelineCorpus: GUIDELINE_CORPUS.filter((chunk) => chunk.profiles.includes(profileId)),
  }
}

export const CLINICAL_PROFILES: Readonly<Record<ProfileId, ClinicalProfile>> = Object.fromEntries(
  PROFILE_IDS.map((id) => [id, { id, ...PROFILE_DEFINITIONS[id], ...selectProfileContent(id) }]),
) as Record<ProfileId, ClinicalProfile>

export const DEFAULT_PROFILE_ID: ProfileId = 'adult-acute-urti'

export function getClinicalProfile(profileId: ProfileId = DEFAULT_PROFILE_ID): ClinicalProfile {
  return CLINICAL_PROFILES[profileId]
}
