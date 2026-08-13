import { GAP_CHECKLIST_VERSION } from '../gaps/index.js'
import { GUIDELINE_CORPUS_VERSION } from '../guidelines/index.js'
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
 */
export const ACTIVE_CLINICAL_VERSIONS = {
  redFlagList: RED_FLAG_LIST_VERSION,
  gapChecklist: GAP_CHECKLIST_VERSION,
  guidelineCorpus: GUIDELINE_CORPUS_VERSION,
} as const satisfies Record<string, ClinicalArtefactVersion>
