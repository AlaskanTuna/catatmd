import type { Transcript } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'
import type { RedFlagTrigger } from './types.js'

/**
 * docs/trd.md §10 "What Stays Undecided": no clinician has validated this
 * list. It is sourced from the Malaysian corpus named in docs/trd.md §11
 * (MOH NAG 4th ed. 2024, Abdullah et al. 2024, Ooi et al. 2022) rather than
 * NICE, whose licence forbids AI use. Where those sources restate Centor /
 * McIsaac, this list expresses them in our own words per docs/trd.md §10.
 *
 * Bumped whenever a trigger is added, removed, or its matcher or severity
 * changes. Recorded with every analysis (docs/trd.md §15).
 */
export const RED_FLAG_LIST_VERSION: ClinicalArtefactVersion = {
  id: 'redflag-list-v2',
  effectiveDate: '2026-08-14',
}

const URTI_PROFILES: readonly ProfileId[] = ['adult-acute-urti']
const URTI_AND_UTI_PROFILES: readonly ProfileId[] = [
  'adult-acute-urti',
  'adult-acute-uncomplicated-uti',
]
const UTI_PROFILES: readonly ProfileId[] = ['adult-acute-uncomplicated-uti']

const findSpan = (transcript: Transcript, patterns: readonly RegExp[]): string | null => {
  for (const turn of transcript.turns) {
    for (const pattern of patterns) {
      const match = pattern.exec(turn.text)
      if (match) return match[0]
    }
  }
  return null
}

const NAG_SCOPE_NOTE =
  'MOH National Antimicrobial Guideline (NAG) 4th ed. 2024, §C1/C3 (acute bronchitis / acute ' +
  'pharyngitis): the antimicrobial-decision algorithms there presuppose an uncomplicated URTI ' +
  'presentation; this finding sits outside that scope and needs clinical reassessment beyond ' +
  'the antibiotic decision.'

const DELPHI_AIRWAY_NOTE =
  'Abdullah et al. (2024), Malaysian sore-throat Delphi consensus, Infect Drug Resist: the ' +
  'McIsaac-scored antibiotic pathway that consensus establishes presupposes the absence of ' +
  'airway or swallowing compromise; this finding sits outside that pathway.'

export const REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  {
    id: 'haemoptysis',
    label: 'Haemoptysis reported — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /cough(?:ing)?\s+up\s+blood/i,
        /blood[- ]tinge?d?\s+(?:sputum|phlegm|mucus)/i,
        /blood\s+in\s+(?:the\s+|my\s+|his\s+|her\s+)?(?:sputum|phlegm|mucus|cough)/i,
        /\bha?emoptysis\b/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'significant-dyspnoea',
    label: 'Significant breathlessness reported — needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /can'?t\s+breathe/i,
        /cannot\s+breathe/i,
        /difficult(?:y)?\s+breathing/i,
        /short(?:ness)?\s+of\s+breath/i,
        /\bbreathless(?:ness)?\b/i,
        /struggling\s+to\s+breathe/i,
        /gasping\s+for\s+(?:air|breath)/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'chest-pain',
    label: 'Chest pain reported — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /chest\s+pain/i,
        /pain\s+in\s+(?:my|the|his|her)\s+chest/i,
        /tight(?:ness)?\s+in\s+(?:my|the|his|her)\s+chest/i,
      ]),
    clinicalSource: NAG_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'stridor-airway-compromise',
    label: 'Possible airway compromise (stridor) — needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bstridor\b/i,
        /noisy\s+breathing/i,
        /\bdrooling\b/i,
        /\btrismus\b/i,
        /muffled\s+voice/i,
        /voice\s+sounds?\s+muffled/i,
      ]),
    clinicalSource: DELPHI_AIRWAY_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    id: 'swallowing-oral-intake',
    label: 'Unable to swallow or maintain oral intake — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /can'?t\s+swallow/i,
        /unable\s+to\s+swallow/i,
        /can'?t\s+(?:keep|hold)\s+(?:anything|fluids|food|water)\s+down/i,
        /not\s+(?:been\s+)?able\s+to\s+(?:eat|drink)/i,
        /refusing\s+to\s+(?:eat|drink)/i,
        /no\s+oral\s+intake/i,
      ]),
    clinicalSource: DELPHI_AIRWAY_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_PROFILES,
  },
  {
    /**
     * No numeric vital-sign cutoff (SpO2 / RR / HR / BP) attributable to
     * docs/trd.md §11's corpus was located — NAG 2024, Abdullah et al. 2024,
     * and Ooi et al. 2022 do not publish one for this scope, and no clinician
     * is available to validate an invented number (docs/trd.md §10, Q7).
     * Rather than invent a threshold, this trigger matches the clinician's
     * own stated severity assessment of a vital sign in the transcript.
     */
    id: 'vital-signs-concern',
    label: 'Vital sign described as critically abnormal — needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /oxygen\s+(?:level|saturation|sats?)\D{0,20}(?:low|dropping|falling|desaturat\w*)/i,
        /(?:temperature|fever)\D{0,20}(?:very\s+high|extremely\s+high|not\s+coming\s+down|won'?t\s+come\s+down)/i,
        /(?:heart\s+rate|pulse)\D{0,20}(?:very\s+fast|racing|dangerously\s+(?:high|fast))/i,
        /blood\s+pressure\D{0,20}(?:very\s+low|dropping|dangerously\s+low)/i,
      ]),
    clinicalSource:
      'No Malaysian-sourced numeric vital-sign threshold found in the docs/trd.md §11 corpus ' +
      "(NAG 2024, Abdullah et al. 2024, Ooi et al. 2022); this trigger matches the clinician's " +
      'own stated severity assessment rather than an invented cutoff — see docs/trd.md §10 ' +
      '"What Stays Undecided".',
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: URTI_AND_UTI_PROFILES,
  },
]

const UTI_SCOPE_NOTE =
  'MOH National Antimicrobial Guideline (NAG) 4th ed. 2024, urinary tract infection guidance: ' +
  'this prototype surfaces a deliberately broad escalation prompt when the transcript describes ' +
  'a feature that can fall outside an uncomplicated adult primary-care presentation. No clinician ' +
  'has reviewed this trigger content.'

export const UTI_REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  {
    id: 'uti-systemic-features',
    label: 'Fever, chills, or rigors reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bfever(?:ish)?\b/i,
        /\bchills?\b/i,
        /\brigors?\b/i,
        /\bshiver(?:ing)?\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-flank-or-back-pain',
    label: 'Flank or back pain reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bflank\b/i,
        /\bloin\b/i,
        /\bkidney\s+pain\b/i,
        /(?:pain|ache)\s+(?:in\s+)?(?:my\s+)?(?:lower\s+)?back\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-systemic-deterioration',
    label: 'Possible systemic deterioration reported, needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bconfus(?:ed|ion)\b/i,
        /\bfaint(?:ed|ing)?\b/i,
        /\bvery\s+drowsy\b/i,
        /\bextremely\s+weak\b/i,
        /\bfeeling\s+very\s+unwell\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-pregnancy-mentioned',
    label: 'Pregnancy or possible pregnancy mentioned, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\bpregnan(?:t|cy)\b/i,
        /\bmissed\s+(?:my\s+)?period\b/i,
        /\btrying\s+for\s+(?:a\s+)?baby\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-unable-to-pass-urine',
    label: 'Unable to pass urine reported, needs your attention',
    severity: 'emergency',
    matcher: (transcript) =>
      findSpan(transcript, [
        /(?:can'?t|cannot|unable\s+to)\s+(?:pass|pee|urinate)/i,
        /\bnot\s+passing\s+(?:any\s+)?urine\b/i,
        /\bno\s+urine\s+(?:is\s+)?coming\s+out\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
  {
    id: 'uti-potentially-complicating-context',
    label: 'Potentially complicating urinary context reported, needs your attention',
    severity: 'urgent',
    matcher: (transcript) =>
      findSpan(transcript, [
        /\b(?:urinary\s+)?catheter(?:ised|ized)?\b/i,
        /\bkidney\s+(?:disease|failure|transplant)\b/i,
        /\bsingle\s+kidney\b/i,
        /\bimmunosuppress(?:ed|ion)\b/i,
        /\bdiabetes?\b/i,
        /\bmale\b/i,
      ]),
    clinicalSource: UTI_SCOPE_NOTE,
    listVersion: RED_FLAG_LIST_VERSION.id,
    profiles: UTI_PROFILES,
  },
]

export const ALL_REDFLAG_TRIGGERS: readonly RedFlagTrigger[] = [
  ...REDFLAG_TRIGGERS,
  ...UTI_REDFLAG_TRIGGERS,
]
