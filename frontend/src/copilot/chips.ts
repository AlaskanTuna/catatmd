/**
 * The suggested-question chips (GitHub issue #169).
 *
 * **Written here rather than generated.** Asking the model what to ask itself
 * costs a second provider call before the doctor has typed anything, and it
 * produces suggestions that drift with the model. A fixed pool is instant,
 * free, reviewable by a clinician, and cannot invent a question that implies
 * the copilot can do something it cannot.
 *
 * They are drawn at random so the panel does not look like a static menu, and
 * because the four that happen to be visible should not train a habit of only
 * asking those four.
 *
 * **Every one of these is about the record, not the patient.** "What is still
 * missing" is a documentation question; "what is wrong with this patient" is a
 * diagnostic one the copilot must refuse, and a chip that invites a refusal is
 * a chip that teaches the doctor the tool is useless.
 */

/** Shown on an empty panel, before the doctor has asked anything. */
export const OPENING_QUESTIONS = [
  'What is still missing before I can sign this off?',
  'Summarise this consultation in three lines.',
  'Which red flags have I not decided on yet?',
  'Does the plan cover safety-netting?',
  'Is anything in the note unsupported by the transcript?',
  'What did the patient say about their symptoms?',
  'Which checklist fields are still unassessed?',
  'Is the assessment section specific enough?',
  'Did I document the medication I dispensed?',
  'What would another GP question about this note?',
] as const

/** Offered after an answer, to keep the review moving. */
export const FOLLOW_UP_QUESTIONS = [
  'Tighten the wording of the assessment.',
  'Add a safety-net line to the plan.',
  'What guidance supports that?',
  'Anything else before I sign off?',
  'Rewrite the subjective more concisely.',
  'Which gap should I deal with first?',
  'Is the plan clear enough for the patient?',
  'Explain that in one sentence.',
  'Show me what the transcript actually says.',
  'Is there anything I should double-check?',
] as const

export const OPENING_CHIPS = 4
export const FOLLOW_UP_CHIPS = 4

/**
 * `n` distinct entries, chosen without replacement.
 *
 * Takes the pool and returns a new array rather than shuffling in place: these
 * pools are module constants, and a sort that mutated them would reorder the
 * source for every later caller in the session.
 */
export function pickRandom<T>(pool: readonly T[], n: number): T[] {
  const copy = [...pool]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a !== undefined && b !== undefined) {
      copy[i] = b
      copy[j] = a
    }
  }
  return copy.slice(0, Math.min(n, copy.length))
}
