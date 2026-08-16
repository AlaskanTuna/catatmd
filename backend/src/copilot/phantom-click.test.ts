import { describe, expect, it } from 'vitest'
import { hasPhantomClickInstruction } from './phantom-click.js'

/**
 * The phantom-click detector (GitHub issue #185).
 *
 * This is a regression guard, not a reproduction of a defect. It was measured at
 * 0 of 90 turns on the shipped prompt. It exists because the two prompt
 * revisions trialled for #185 both moved the model toward talking about cards,
 * and one of them started claiming a card was waiting when none was; both were
 * rejected on the measurements, but the next attempt will push the same way.
 * See §25 of `docs/trd.md`.
 *
 * The false-positive cases matter as much as the true ones. This runs over
 * clinical prose, where `pressure` is in every set of vitals, so a detector that
 * cried wolf on a blood-pressure reading would be discarded within a week and
 * the real signal would go with it.
 *
 * Every inflection is spelled out below rather than sampled, because the bug
 * this replaced was an inflection bug in both directions at once: a shared
 * suffix group accepted `tapes` and silently dropped `tapping`, `tapped`,
 * `clicked` and `pressed`. A detector that misses the past tense misses "once
 * you have clicked Apply", which is the defect stated in the most natural way.
 */

describe('a turn that points at a card it never rendered', () => {
  it('flags a click instruction when nothing was proposed', () => {
    expect(
      hasPhantomClickInstruction('You can click Apply on the card to add that to the plan.', 0),
    ).toBe(true)
  })

  it('flags every inflection of all three verbs', () => {
    for (const word of [
      'click',
      'clicks',
      'clicked',
      'clicking',
      'tap',
      'taps',
      'tapped',
      'tapping',
      'press',
      'presses',
      'pressed',
      'pressing',
    ]) {
      expect(hasPhantomClickInstruction(`You can ${word} Apply to accept it.`, 0)).toBe(true)
    }
  })

  it('flags the past tense, which is how the defect is stated most naturally', () => {
    // The regression that motivated spelling the inflections out. A doctor
    // reading "once you have clicked Apply" has been told a card exists.
    expect(hasPhantomClickInstruction('Once you have clicked Apply, the plan will read:', 0)).toBe(
      true,
    )
    expect(hasPhantomClickInstruction('Tapping Apply will add it to the plan.', 0)).toBe(true)
  })

  it('ignores case', () => {
    expect(hasPhantomClickInstruction('CLICK the button.', 0)).toBe(true)
  })
})

describe('what must not be flagged', () => {
  it('says nothing about a turn that did render a card', () => {
    expect(hasPhantomClickInstruction('Proposed for the plan. Click Apply to accept it.', 1)).toBe(
      false,
    )
  })

  it('does not read a blood pressure as an instruction to press something', () => {
    expect(hasPhantomClickInstruction('Blood pressure was 128/76 at triage.', 0)).toBe(false)
    expect(hasPhantomClickInstruction('There is no record of her pressure today.', 0)).toBe(false)
  })

  it('does not match the word inside a longer one', () => {
    for (const word of [
      'clickbait',
      'tapering',
      'tapestry',
      'tapas',
      'taped',
      'tapes',
      'pressure',
      'depress',
      'compress',
      'depressed',
    ]) {
      expect(hasPhantomClickInstruction(`The note mentions ${word} in passing.`, 0)).toBe(false)
    }
  })

  it('does not read a steroid taper as an instruction to tap something', () => {
    // `tapering` is in every plan that steps a dose down, and the pattern this
    // replaced matched it.
    expect(hasPhantomClickInstruction('Consider tapering the steroids over a week.', 0)).toBe(false)
  })

  it('says nothing about ordinary prose with no card language', () => {
    expect(hasPhantomClickInstruction('The plan does not yet say when she should return.', 0)).toBe(
      false,
    )
  })
})

/**
 * Pinned as limitations rather than left to be discovered as bugs. Both are
 * examination verbs that collide with the UI sense, and neither is worth the
 * complexity of resolving: distinguishing them needs the surrounding clause,
 * and this is a screening diagnostic whose matches the eval prints for a human
 * to confirm. They are recorded here so that a future non-zero reading is read
 * as "check the printed examples" rather than as a confirmed defect.
 */
describe('known false positives, accepted deliberately', () => {
  it('matches palpation described with press or tap', () => {
    expect(hasPhantomClickInstruction('She presses on the tragus and it hurts.', 0)).toBe(true)
    expect(hasPhantomClickInstruction('Pressing over the sinuses reproduced the pain.', 0)).toBe(
      true,
    )
  })
})

/**
 * The gaps, pinned so they are known rather than discovered. Issue #185's prose
 * says the model must never tell the doctor to "click, tap or approve"
 * something, while the regex it then specifies is `/click|tap|press/i`. The
 * regex is what is implemented, and these cases are why.
 */
describe('known blind spots, accepted deliberately', () => {
  it('leaves ordinary approval talk alone, which is why approve is not in the pattern', () => {
    // Hard rule 3 requires the model to be able to say this. A pattern matching
    // `approve` would flag the rule working correctly.
    expect(hasPhantomClickInstruction('I cannot approve a note; sign-off is yours alone.', 0)).toBe(
      false,
    )
    expect(hasPhantomClickInstruction('Two items remain unchecked before you approve.', 0)).toBe(
      false,
    )
  })

  it('misses a bare approve with no click verb', () => {
    // The one instance actually observed was "Click approve to apply", which
    // this catches on the `click` branch, so dropping `approve` from the
    // pattern loses nothing that has been seen. Closing this would mean
    // matching `approve` near an apply-ish word, which is a clause parser in
    // disguise.
    expect(hasPhantomClickInstruction('Approve to apply this change.', 0)).toBe(false)
  })

  it('misses a claim that a card exists when none does', () => {
    // A distinct failure class, found while measuring #185: a turn asserting
    // "the card is waiting for your review" with zero proposals points at a
    // nonexistent affordance without using any of the three verbs. It does not
    // occur on the shipped prompt (0 of 90 turns) but appeared at 3 of 90 under
    // one rejected prompt revision, which is what makes it worth naming.
    expect(
      hasPhantomClickInstruction('Proposal sent to update the objective. The card is waiting.', 0),
    ).toBe(false)
  })
})
