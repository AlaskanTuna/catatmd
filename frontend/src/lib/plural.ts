/**
 * `3 red flags`, `1 red flag`.
 *
 * Promoted out of `routes/ConsultationList.tsx` when the analysis toast became
 * the second caller. Counts appear in transient feedback across the app and a
 * second copy of the rule is how "1 gaps" eventually ships from one of them.
 *
 * Naive on purpose: every noun it is given here is regular, and the callers are
 * app copy rather than clinical content, so an irregular-plural table would be
 * machinery for a case that does not exist.
 */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
