import { type ClinicalAssertion, ClinicalFactsResponseSchema } from '@shared/types'
import type { ClinicalProfile } from '../clinical-profiles/index.js'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { applyEvidenceCheck, type EvidenceCheckResult } from './evidence.js'
import { buildClinicalFactsSystemPrompt } from './prompt.js'

/**
 * Ambient capture's model-backed live pass (#219).
 *
 * It is `analyseNote`'s extraction half, pointed at one window instead of a
 * whole consultation. Two things it deliberately does **not** do:
 *
 * - It does not write a note. docs/trd.md §20.8.1 measures every
 *   extract-then-write variant as less grounded than writing from the
 *   transcript (0.971 against 0.914 to 0.946), and a note folded from a
 *   previous note is that shape by another route. The note is written once, at
 *   Finish, by the unchanged pipeline.
 * - It does not ask what is missing. `deriveGaps` enumerates a checklist over
 *   the merged assertion states, which is absence detection by construction.
 *   Model judges score 0.50 to 0.63 at spotting missing content, which is
 *   guessing.
 */

/**
 * Appended to the standard extraction prompt.
 *
 * The model is told it is reading a fragment so it stops guessing at the parts
 * it cannot see. Saying that the merge happens in code is the load-bearing
 * sentence: without it a model asked for a full checklist over a partial
 * transcript tends to fill the gaps rather than leave them, and a confabulated
 * `DENIED` is exactly the failure the evidence check exists to catch.
 */
const LIVE_WINDOW_NOTE = `THIS TRANSCRIPT IS ONE WINDOW OF A CONSULTATION STILL IN PROGRESS.

You are seeing a fragment, not the whole encounter, and it may begin or end
mid-topic. Assert only what THIS window establishes. Everything the window does
not cover stays NOT_ASSESSED: do not infer it, do not carry it over, and do not
guess at what an earlier part of the consultation may have said.

An earlier window's answers are merged with yours in code, so a field you leave
NOT_ASSESSED is not lost. Filling one in without evidence in this window is the
only way to make the result wrong.`

export function buildLiveFactsSystemPrompt(profile: ClinicalProfile): string {
  return `${buildClinicalFactsSystemPrompt(profile)}

${LIVE_WINDOW_NOTE}`
}

/**
 * Extracts facts from one de-identified window.
 *
 * `content` and `deltaText` carry the same window: `content` as the branded
 * type the LLM port requires, `deltaText` as a plain string for the evidence
 * check to match spans against. Spans are checked against **this window only**,
 * which is correct rather than a limitation: a span the model quotes must
 * appear in the text the model was shown, and a field established in an earlier
 * window keeps its already-checked evidence through the fold.
 */
export async function analyseLiveWindow(
  content: Deidentified,
  deltaText: string,
  profile: ClinicalProfile,
): Promise<EvidenceCheckResult> {
  const client = getLLMClient()

  const facts = await client.generate({
    operation: 'live_facts',
    system: buildLiveFactsSystemPrompt(profile),
    content,
    schema: ClinicalFactsResponseSchema,
    schemaName: 'clinical_facts',
  })

  return applyEvidenceCheck(facts.clinicalFacts, facts.operational, deltaText)
}

/** `OperationalBlockSchema`'s own ceiling on `medicationsDispensed`. */
const MAX_DISPENSED_ITEMS = 10

/** The two states `deriveGaps` counts as a gap, so the two cannot drift apart. */
const established = (assertion: ClinicalAssertion): boolean =>
  assertion.state !== 'NOT_ASSESSED' && assertion.state !== 'UNKNOWN'

const isAssertion = (node: unknown): node is ClinicalAssertion =>
  node !== null &&
  typeof node === 'object' &&
  !Array.isArray(node) &&
  typeof (node as { state?: unknown }).state === 'string'

const isRecord = (node: unknown): node is Record<string, unknown> =>
  node !== null && typeof node === 'object' && !Array.isArray(node)

/**
 * Walks the structure rather than a hard-coded field list, for the same reason
 * `rehydrateAssertions` does: `ClinicalFacts` is four nested groups,
 * `OperationalBlock` holds an array of assertions, and a field list would
 * silently stop covering a field the moment the checklist grows.
 */
function fold(previous: unknown, incoming: unknown, monotoneScalars: boolean): unknown {
  if (isAssertion(previous) && isAssertion(incoming)) {
    if (!monotoneScalars) return incoming
    return established(previous) && !established(incoming) ? previous : incoming
  }
  if (Array.isArray(previous) && Array.isArray(incoming)) {
    /*
     * `medicationsDispensed`, unioned rather than replaced. Replacing looked
     * right and was not: a window naming a second drug would erase the first,
     * so the one field holding an itemised dispensing list was the only
     * established content the fold could silently drop. Keyed on the assertion
     * value so the same drug named twice does not double, and capped at the
     * schema's own maximum.
     */
    const seen = new Set<string>()
    const merged: unknown[] = []
    for (const item of [...previous, ...incoming]) {
      const identity = isAssertion(item) ? (item.value ?? '') : JSON.stringify(item)
      if (identity === '' || seen.has(identity)) continue
      seen.add(identity)
      merged.push(item)
    }
    return merged.slice(0, MAX_DISPENSED_ITEMS)
  }
  if (isRecord(previous) && isRecord(incoming)) {
    const merged: Record<string, unknown> = { ...incoming }
    for (const [name, before] of Object.entries(previous)) {
      merged[name] =
        incoming[name] === undefined ? before : fold(before, incoming[name], monotoneScalars)
    }
    return merged
  }
  return incoming
}

/**
 * Field-wise monotone merge: a field that has been established never slides
 * back to unestablished.
 *
 * **This is why the previous facts are never sent to the model.** The key set
 * is fixed, so the merge is decidable in code: cheaper than asking, and unlike
 * asking it cannot be argued out of a fact the transcript already established.
 * It is the same reasoning that makes `deriveGaps` stronger than a model judge.
 *
 * An established field may still be corrected by another established value, a
 * patient revising themselves being ordinary rather than churn. Only the slide
 * back to unknown is refused, because that is the one that would blank a line
 * the doctor has already read.
 */
export function foldFacts<T>(previous: T | null | undefined, incoming: T): T {
  if (previous === null || previous === undefined) return incoming
  return fold(previous, incoming, true) as T
}

/**
 * The operational block, where the newest window wins on every scalar.
 *
 * Deliberately *not* monotone, and the asymmetry is the point. Holding a
 * finding is the safe direction for a symptom: the patient reported it, and no
 * later silence unreports it. It inverts for a clinical conclusion. A model
 * reading one window can latch onto a doctor thinking aloud, and under the
 * monotone rule nothing could ever take that back, because `NOT_ASSESSED`
 * never wins. The evidence check proves only that the span exists in the
 * transcript, not that it asserts anything. This block holds the field the "no
 * output is a diagnosis" invariant rests on, so it follows the newest window
 * and Finish settles it.
 *
 * Expressed per block rather than per field on purpose: naming the field here
 * would put a clinical rule outside the versioned data, which
 * `no-stray-clinical-constants.test.ts` exists to prevent, and it caught
 * exactly that in the first version of this fix.
 *
 * The array branch still unions, so an itemised dispensing list keeps growing.
 * The cost is that a scalar stated mid-consultation can blank if a later window
 * does not repeat it. That is cosmetic and self-correcting, where a latched
 * conclusion is neither.
 */
export function foldOperational<T>(previous: T | null | undefined, incoming: T): T {
  if (previous === null || previous === undefined) return incoming
  return fold(previous, incoming, false) as T
}
