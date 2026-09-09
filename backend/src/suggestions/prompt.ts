import type { GuidelineChunk } from '@shared/types'
import type { ClinicalProfile } from '../clinical-profiles/index.js'
import { serialiseCorpusForPrompt } from '../guidelines/index.js'

/**
 * Shared opening for both halves of Operation 2. The de-identification note and
 * the language rule apply to any call reading a consultation transcript, and
 * duplicating them was how they would drift apart.
 */
function preamble(profile: ClinicalProfile, writing: string): string {
  return `You are assisting a Malaysian GP who is reviewing a de-identified consultation
transcript for ${profile.scope}. Text such as "[PATIENT_1]" or "[NRIC_1]" is a
de-identification token, not the patient's real identifier; never attempt to
guess, reconstruct, or comment on the identity behind a token. The transcript
may be in English, Bahasa Malaysia, or code-switched Malaysian speech. Write
${writing} in English, and quote any transcript evidence verbatim in its
original language, never translated.`
}

/**
 * `red_flags` (docs/trd.md §12, Operation 2a). A Tier-4 control (docs/trd.md
 * §21.3) and never relied on alone. Every safety property it states in words is
 * also enforced structurally:
 *
 * - "these are candidates only, never authoritative" is backed by
 *   `RedFlagCandidatesSchema` pinning `source` to `z.literal('model')` and
 *   omitting `ruleId`, so a response is structurally incapable of
 *   impersonating the deterministic rules engine (docs/trd.md §10).
 * - "a red flag carries no citation" is backed by the schema omitting
 *   `guidelineIds`, and by this call never receiving a corpus at all.
 *
 * **No corpus reaches this prompt** (#340). Red-flag candidates are read out of
 * the transcript, not out of a guideline, so serialising the retrieved chunks
 * into this call bought nothing and cost the input tokens of the whole
 * retrieved set on every analysis.
 */
export function buildRedFlagsSystemPrompt(profile: ClinicalProfile): string {
  return `${preamble(profile, 'red-flag candidates')}

Task - red-flag candidates:
Propose any additional escalation-relevant findings you notice in the
transcript as red-flag candidates. These are candidates only, for the
doctor's own review. A separate, deterministic rules engine already runs
independently of this call, and its findings are authoritative; you never
see its output and your candidates can never override, suppress, downgrade,
or replace anything it reports. If you find nothing additional, return an
empty red-flag list; do not report a hit you are not confident the
transcript actually supports. A candidate must describe a finding that
would itself justify escalation, not a normal or expected finding restated
as a concern. Never flag a symptom the patient explicitly denies, and never
flag a symptom the doctor mentions only as advice about when to return.

Scope:
Set outOfScope to true if the transcript describes a presentation outside
${profile.scope}, and false when it is in scope. This is a record of what the
consultation was about and nothing else: it never suppresses a red-flag
candidate, so report every candidate you find either way.`
}

/**
 * `suggestions` (docs/trd.md §12, Operation 2b). The half that cites, and the
 * only half that receives the corpus.
 *
 * - "cite only ids from the corpus below" is backed by `z.enum(corpusIds)` at
 *   decode time (docs/trd.md §11).
 * - "never state a diagnosis" has no structural backstop here; `suggestions`
 *   is free text, so it is stated explicitly, alongside the reminder that this
 *   call never sees or influences the rules engine's own output.
 *
 * `corpus` is never empty. A consultation with nothing retrieved cannot
 * support a cited suggestion, so the caller skips this operation rather than
 * asking the model for an empty array (#340).
 */
export function buildSuggestionsSystemPrompt(
  profile: ClinicalProfile,
  corpus: readonly GuidelineChunk[],
): string {
  return `${preamble(profile, 'suggestions')}

Task - guideline-cited suggestions:
Using ONLY the guideline corpus listed below, propose clinical suggestions that
this transcript's content actually supports. Every suggestion must cite at
least one guideline id from the corpus below by its exact [id], citing any id
not listed here is invalid and will be rejected. Do not merge guidance from
different sources into one suggestion, and do not invent or paraphrase a
source that is not listed. Never state a diagnosis; a suggestion describes a
guideline-aligned consideration for the doctor to weigh, not a conclusion.
A separate, deterministic rules engine reports escalation findings; you never
see its output and nothing you write here can change it.

If the transcript describes a presentation outside ${profile.scope}, the corpus
below does not cover it and a cited suggestion would be unsupported. Return an
empty suggestions array rather than reaching for the nearest chunk.

Guideline corpus (cite by the bracketed id only):
${serialiseCorpusForPrompt(corpus)}
Chunks whose title carries a page number are retrieved spans of a Malaysian Clinical Practice Guideline; cite them by id exactly like the others, and only when the span itself supports the suggestion.`
}
