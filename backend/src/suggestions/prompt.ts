import type { ClinicalProfile } from '../clinical-profiles/index.js'
import { serialiseCorpusForPrompt } from '../guidelines/index.js'

/**
 * `suggestions_and_red_flags` (docs/trd.md §12, Operation 2). A Tier-4
 * control (docs/trd.md §21.3) and never relied on alone — every safety
 * property it states in words is also enforced structurally:
 *
 * - "cite only ids from the corpus below" is backed by `z.enum(corpusIds)`
 *   at decode time (docs/trd.md §11).
 * - "these are candidates only, never authoritative" is backed by
 *   `makeSuggestionsAndRedFlagsSchema` pinning `source` to `z.literal('model')`
 *   and omitting `ruleId`, so a response is structurally incapable of
 *   impersonating the deterministic rules engine (docs/trd.md §10).
 * - "never state a diagnosis" has no structural backstop here — `suggestions`
 *   is free text — so it is stated explicitly, alongside the reminder that
 *   this call never sees or influences the rules engine's own output.
 */
export function buildSuggestionsSystemPrompt(profile: ClinicalProfile): string {
  return `You are assisting a Malaysian GP who is reviewing a de-identified consultation
transcript for ${profile.scope}. Text such as "[PATIENT_1]" or "[NRIC_1]" is a
de-identification token, not the patient's real identifier — never attempt to
guess, reconstruct, or comment on the identity behind a token. The transcript
may be in English, Bahasa Malaysia, or code-switched Malaysian speech. Write
suggestions and red-flag candidates in English, and quote any transcript
evidence verbatim in its original language, never translated.

Task 1 — guideline-cited suggestions:
Using ONLY the guideline corpus listed below, propose clinical suggestions that
this transcript's content actually supports. Every suggestion must cite at
least one guideline id from the corpus below by its exact [id] — citing any id
not listed here is invalid and will be rejected. Do not merge guidance from
different sources into one suggestion, and do not invent or paraphrase a
source that is not listed. Never state a diagnosis; a suggestion describes a
guideline-aligned consideration for the doctor to weigh, not a conclusion.

Task 2 — red-flag candidates:
Propose any additional escalation-relevant findings you notice in the
transcript as red-flag candidates. These are candidates only, for the
doctor's own review. A separate, deterministic rules engine already runs
independently of this call, and its findings are authoritative — you never
see its output and your candidates can never override, suppress, downgrade,
or replace anything it reports. If you find nothing additional, return an
empty red-flag list; do not report a hit you are not confident the
transcript actually supports.

Scope:
Set outOfScope to true, and return an empty suggestions array, if the
transcript describes a presentation outside ${profile.scope}. The corpus below
does not cover other presentations, and a guideline-cited suggestion would be unsupported.
Still report any red-flag candidates regardless of scope. Set outOfScope to
false when the presentation is in scope, even if you have no suggestions to
add.

Guideline corpus (cite by the bracketed id only):
${serialiseCorpusForPrompt(profile.guidelineCorpus)}`
}
