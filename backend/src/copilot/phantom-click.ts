/**
 * Detects a copilot turn that tells the doctor to click something it never
 * rendered (GitHub issue #185).
 *
 * **This is a diagnostic, not a control.** Nothing in `runCopilotTurn` calls
 * it, and no answer that trips it is suppressed or rewritten. That is
 * deliberate. The only thing a runtime guard could do here is edit clinical
 * prose to fix a wording problem, and `prompt.ts` is explicit that the schemas
 * carry safety while the prompt carries usefulness and register. A phantom
 * click is a register defect, so the prompt is where it is addressed and this
 * is how it is watched.
 *
 * It is exported rather than left as a literal inside each caller so that the
 * unit pin and `evals/copilot-proposals.ts` cannot drift apart. A pin that has
 * quietly stopped meaning what the measurement means is worse than no pin.
 *
 * Measured at 0 of 90 turns on the shipped prompt (§25 of `docs/trd.md`), so it
 * watches a failure that is not currently happening. It is kept because both
 * prompt revisions trialled for #185 moved the model toward talking about
 * cards, and the second began asserting that a card was waiting when none had
 * been rendered. Neither shipped, but the next attempt will push the same way.
 *
 * **The 0 of 54 measured against production on 16/08/26 does not carry over to
 * this pattern.** That run scored with an earlier regex that was blind to
 * `presses`, `pressed` and `pressing`, so its zero is evidence about a narrower
 * question than the one asked here. The turn texts were not kept, so it cannot
 * be rescored; the eval now persists every turn, so the next detector change is
 * a rescan rather than a re-measure.
 */

/**
 * Anchored on both sides, and inflected **per verb** rather than through one
 * shared suffix group.
 *
 * The anchoring is what keeps the clinical register out. `pressure` is in every
 * set of vitals and `tapering` in every plan that steps a dose down, and both
 * begin with one of these verbs.
 *
 * The per-verb spelling is not stylistic. A shared `(?:s|es|ing)?` group forms
 * a cross-product, which both over- and under-matches: it accepts `tapes`
 * (`tap` + `es`), and it misses `tapping` entirely, because English doubles the
 * consonant and `tap` + `ing` spells `taping`. Missing it matters more than the
 * false positive, since "after tapping Apply" is an ordinary phantom click on a
 * touch device. The `-ed` forms are here for the same reason: "once you have
 * clicked Apply" is the defect, not a description of it.
 *
 * What it still cannot separate is palpation: "a pressing sensation" and "press
 * on the abdomen" both match, and telling them from a UI instruction needs the
 * surrounding clause. Those are pinned as accepted false positives in the test,
 * and the eval prints the matching text rather than trusting the count.
 *
 * `approve` is deliberately absent, though the issue's prose names it. It is
 * ordinary vocabulary here, including in hard rule 3, so matching it would flag
 * the model correctly refusing to approve a note. The one instance ever
 * observed was "Click approve to apply", which the `click` branch catches
 * anyway. Two blind spots follow from that and are pinned in the test: a bare
 * "Approve to apply", and a turn claiming a card exists ("the card is waiting
 * for your review") without using any of the three verbs.
 *
 * Exported for that display only. The decision belongs to
 * `hasPhantomClickInstruction`, which also requires that no card was rendered;
 * matching this pattern on a turn that did propose is not a defect at all.
 */
export const CLICK_INSTRUCTION =
  /\b(?:click(?:s|ed|ing)?|tap(?:s|ped|ping)?|press(?:es|ed|ing)?)\b/i

export function hasPhantomClickInstruction(text: string, proposalCount: number): boolean {
  return proposalCount === 0 && CLICK_INSTRUCTION.test(text)
}
