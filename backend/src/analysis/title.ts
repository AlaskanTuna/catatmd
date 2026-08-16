import type { ClinicalFacts } from '@shared/types'

/**
 * The filing name a consultation gets when it is analysed.
 *
 * **Composed in code, never generated.** A title is the most prominent text in
 * the product: it is the record's identity in every list and the first line on
 * the detail page. Asking a model for one would put generated prose in exactly
 * the position where `docs/prd.md` §10 forbids it, because a sentence like
 * "likely bacterial tonsillitis" is a diagnosis nobody said, and §21.1 measured
 * the model fabricating eight findings on a sparse transcript in 5 of 5 runs.
 * A three-minute upper-respiratory consult is that sparse case.
 *
 * So this is a tier-2 control rather than a tier-4 one (`docs/trd.md` §21.3):
 * it can only name findings that already survived the evidence check, and it
 * structurally cannot state a diagnosis because it never reads the operational
 * block where `diagnosis` lives.
 *
 * **It contains no transcript text.** Only the schema's own field names are
 * used, humanised, never an assertion's `value` or `evidence`. So the derived
 * title carries a clinical category and not one word the patient or the doctor
 * said, which is what keeps it free of identifiers by construction rather than
 * by filtering. The doctor may rename it afterwards to anything at all, and
 * that free text is PHI and erased as such; this is not.
 *
 * **No symptom is named here, and that is a constraint rather than a style.**
 * `no-stray-clinical-constants.test.ts` fails the build on a single-quoted
 * literal equal to a checklist id, and those ids are bare clinical words:
 * `fever`, `haemoptysis`, `sputum-production`. Reading the keys off the parsed
 * object keeps the clinical vocabulary in `shared/` where it is versioned, and
 * means a symptom added to the schema starts appearing in titles with no change
 * here, exactly as `ChecklistPanel` derives the operational block rather than
 * listing it.
 */

/** Ordinary prose, from a camelCase contract key. `soreThroat` -> `sore throat`. */
const humanise = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase()

/**
 * Both states mean the finding is there. `CLINICIAN_OBSERVED` is the doctor's
 * own examination finding, which is at least as title-worthy as a reported
 * symptom, and omitting it would title a consultation by what the patient
 * mentioned while ignoring what the doctor found.
 */
const PRESENT_STATES = new Set(['PRESENT', 'CLINICIAN_OBSERVED'])

/**
 * Three keeps the title a label rather than a summary. A row that lists seven
 * findings is not scannable, which is the entire problem a title solves, and
 * the list truncates anyway.
 */
const MAX_FINDINGS = 3

export function deriveConsultationTitle(clinicalFacts: ClinicalFacts): string | null {
  // Declaration order in `ClinicalFactsSchema`, which is a clinical judgement
  // already made once in `shared/` rather than a second one made here.
  const present = Object.entries(clinicalFacts.symptoms)
    .filter(([, assertion]) => PRESENT_STATES.has(assertion.state))
    .map(([key]) => humanise(key))

  if (present.length === 0) return null

  const shown = present.slice(0, MAX_FINDINGS)
  const title = shown.join(', ')

  // Sentence case, not title case: this is a description of a consultation,
  // and title-casing clinical words makes them read as proper nouns.
  return title.charAt(0).toUpperCase() + title.slice(1)
}
