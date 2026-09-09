import {
  CLINICAL_PROFILES,
  type ClinicalProfile,
  DEFAULT_PROFILE_ID,
  type ProfileId,
} from '../clinical-profiles/index.js'
import { GAP_CHECKLIST_VERSION } from '../gaps/index.js'
import { GUIDELINE_CORPUS_VERSION } from '../guidelines/index.js'
// The file, not the barrel. `medications/index.js` reaches the matcher and
// would pull an npm phonetics package into the analysis route's module graph,
// which is the same discipline `suggestions/safety.ts` documents.
import { MEDICATION_LEXICON_VERSION } from '../medications/lexicon.js'
import { MEDICAL_RECORD_TEMPLATE_VERSION } from '../note-templates/index.js'
import { RED_FLAG_LIST_VERSION } from '../redflags/index.js'
import type { ClinicalArtefactVersion } from './types.js'

export type { ClinicalArtefactVersion } from './types.js'

/**
 * The clinical content active for this build (docs/trd.md §15). Every
 * completed analysis is stamped with this object, so a past note can be traced
 * back to the exact rule list, checklist and corpus that produced it.
 *
 * Each version is defined in the data file it describes, never here: changing
 * one is a diff to that file alone. This module only collects them, which is
 * what makes the stamp a single write rather than three the caller could
 * forget one of.
 *
 * `medicationLexicon` is registered ahead of any consumer, and **no consumer
 * exists today**. Nothing in the analysis pipeline reads it: it belongs to
 * dictated prescription capture (docs/decisions.md D-001), which will run on
 * its own route once #312 and #313 land. It is stamped here anyway because
 * this registry is the one home a version constant may have, and the
 * alternative is a clinical artefact whose version nothing records. Until
 * then an analysis stamp carries a version it did not use, which is why this
 * paragraph exists rather than the fact being left for a reader to discover.
 */
export const ACTIVE_CLINICAL_VERSIONS = {
  redFlagList: RED_FLAG_LIST_VERSION,
  gapChecklist: GAP_CHECKLIST_VERSION,
  guidelineCorpus: GUIDELINE_CORPUS_VERSION,
  medicalRecordTemplate: MEDICAL_RECORD_TEMPLATE_VERSION,
  medicationLexicon: MEDICATION_LEXICON_VERSION,
  clinicalProfile: CLINICAL_PROFILES[DEFAULT_PROFILE_ID].version,
} as const satisfies Record<string, ClinicalArtefactVersion>

/** Every selectable profile is versioned before it can enter an analysis stamp. */
export const ACTIVE_PROFILE_VERSIONS: Readonly<Record<ProfileId, ClinicalArtefactVersion>> =
  Object.fromEntries(
    Object.values(CLINICAL_PROFILES).map((profile) => [profile.id, profile.version]),
  ) as Record<ProfileId, ClinicalArtefactVersion>

export function getActiveClinicalVersions(profile: ClinicalProfile) {
  return {
    ...ACTIVE_CLINICAL_VERSIONS,
    clinicalProfile: ACTIVE_PROFILE_VERSIONS[profile.id],
  }
}

export type ActiveClinicalVersions = ReturnType<typeof getActiveClinicalVersions>
