import {
  type MedicationCandidateWire,
  type Prescription,
  type PrescriptionParseResponse,
  SIG_FOOD_TIMINGS,
  SIG_FREQUENCIES,
  SIG_ROUTES,
  type SigFoodTiming,
  type SigFrequency,
  type SigRoute,
} from '@shared/types'
import type { SelectOption } from '../ui/Select.js'

/**
 * The data half of prescription dictation, with no component attached.
 *
 * It exists because two components now need the same helpers: the card that
 * lists what is recorded and the theatre where the list is built. Both were one
 * 1163 line file before the theatre (#365), and a helper reachable from only one
 * of them would drift the first time either changed.
 *
 * Everything here is pure, so its tests need no DOM.
 */

/**
 * The draft the doctor is filling in, before it is a `Prescription`.
 *
 * Enum fields are the empty string rather than `null` because `Select` speaks
 * strings, and `toPrescription` is the single place that translates back. Every
 * sig field is nullable on the wire, so "not specified" has to survive the
 * round trip rather than being coerced into a value nobody said.
 */
export type PrescriptionDraft = {
  drug: string
  /** Present only while the doctor is standing behind a lexicon candidate. */
  lexiconId?: string
  dose: string
  route: SigRoute | ''
  frequency: SigFrequency | ''
  duration: string
  food: SigFoodTiming | ''
}

export const EMPTY_DRAFT: PrescriptionDraft = {
  drug: '',
  dose: '',
  route: '',
  frequency: '',
  duration: '',
  food: '',
}

/** A half-open range of `parsedFrom`, in characters. */
export type Span = { readonly start: number; readonly end: number }

/**
 * One prescription assembled in the theatre and not yet saved.
 *
 * **`source` is the stretch of the dictation these fields were read from**, not
 * the whole phrase. One dictation can name four drugs, and a row that quoted all
 * four would say nothing about where its own dose came from. It is rendered on
 * the row so a wrong split is visible rather than silent, and it is what travels
 * as `dictated`.
 *
 * `key` survives edits so React keys and focus targets do not move under the
 * doctor while they are typing in the row.
 */
export type StagedPrescription = {
  readonly key: string
  readonly draft: PrescriptionDraft
  readonly source: string
  /**
   * The span of the dictation this row claims, set when it came from accepting
   * a candidate and absent on a row added by hand.
   *
   * **A span rather than a candidate id, because the matcher offers a
   * combination and the single agent inside it as separate candidates.**
   * Resolving only the exact candidate left `amoxicillin` on offer after
   * `amoxicillin-clavulanate` was accepted, so one phrase could become two
   * prescriptions for two different antibiotics. Anything overlapping a claimed
   * span is a decision already made. Removing the row releases the span, which
   * is what puts every one of them back on offer.
   */
  readonly span?: Span
  /**
   * Where `source` was cut from, which is a wider range than `span`.
   *
   * **`span` is the drug's name; this is the stretch its fields were read
   * from.** They are kept apart because they answer different questions: `span`
   * decides which candidates are still on offer, and a candidate contained in
   * an accepted one must be suppressed, while this decides which characters no
   * row can account for. Widening `span` to do both would suppress a candidate
   * merely because it sits downstream of an accepted drug.
   *
   * Absent on a row typed with no dictation behind it, which claims nothing.
   */
  readonly sourceSpan?: Span
}

/**
 * Take a lexicon candidate as the drug name, on the doctor's explicit act.
 *
 * **This is the only writer of `drug` from a candidate, and the only writer of
 * `lexiconId` at all.** `MedicationCandidate` carries `generic` alongside
 * `start` and `end`, which together are a splice instruction the data shape
 * will happily let anything act on; #311 guarantees only that the matcher never
 * rewrites text, so confirm-before-apply is a property this layer has to
 * re-establish rather than inherit. Automatic substitution of a drug name is a
 * named row in `docs/decisions.md` D-001's Not Built table, because look-alike
 * sound-alike confusion is a leading medication-error class.
 */
export function acceptCandidate(
  draft: PrescriptionDraft,
  candidate: MedicationCandidateWire,
): PrescriptionDraft {
  return { ...draft, drug: candidate.generic, lexiconId: candidate.lexiconId }
}

/**
 * Type a drug name by hand, which drops any lexicon provenance with it.
 *
 * `lexiconId` records that the doctor accepted a candidate. Leaving it attached
 * to a name they then edited would claim a match the lexicon never made, so the
 * key goes rather than going stale.
 */
export function setDrugByHand(draft: PrescriptionDraft, drug: string): PrescriptionDraft {
  const next = { ...draft, drug }
  delete next.lexiconId
  return next
}

/**
 * The draft as it goes on the wire, or `null` while it is not yet a
 * prescription.
 *
 * Two shapes matter and neither is obvious from the schema at a glance.
 * `lexiconId` is optional and **not** nullable, so an absent one is omitted
 * rather than sent as `null`. Every sig field is a required key that may be
 * `null`, so what the parser could not read travels as an explicit `null`.
 *
 * `drug` and `dictated` are both `min(1)`, so an empty either way is not a
 * prescription yet. Returning `null` is what keeps Confirm disabled rather than
 * letting the API answer with a 400.
 */
export function toPrescription(draft: PrescriptionDraft, dictated: string): Prescription | null {
  const drug = draft.drug.trim()
  const phrase = dictated.trim()
  if (drug.length === 0 || phrase.length === 0) return null

  return {
    drug,
    ...(draft.lexiconId === undefined ? {} : { lexiconId: draft.lexiconId }),
    dose: draft.dose.trim() === '' ? null : draft.dose.trim(),
    route: draft.route === '' ? null : draft.route,
    frequency: draft.frequency === '' ? null : draft.frequency,
    duration: draft.duration.trim() === '' ? null : draft.duration.trim(),
    food: draft.food === '' ? null : draft.food,
    dictated: phrase,
  }
}

/** A stable identity for a candidate, so rejecting one does not dismiss another. */
export const candidateKey = (candidate: MedicationCandidateWire) =>
  `${candidate.start}:${candidate.end}:${candidate.lexiconId}`

/**
 * The same, for an unclaimed stretch.
 *
 * Keyed on its bounds, so a stretch whose bounds move is a new stretch and is
 * offered again. That is the honest reading: the bounds moved because a row was
 * added or removed, which is a different question from the one dismissed.
 */
export const stretchKey = (stretch: Span) => `${stretch.start}:${stretch.end}`

/**
 * The candidates still on offer, in the order the matcher returned them.
 *
 * **Filtered only, never sorted, grouped or deduped.** The order is score, then
 * span length, then id, and it is a fix rather than a presentation choice: a
 * clinical-safety review on #311 found a contained single agent outranking the
 * combination the doctor actually dictated, because it scored higher on a
 * shorter span. Re-ordering here would reintroduce exactly that.
 */
export function visibleCandidates(
  candidates: readonly MedicationCandidateWire[],
  resolved: ReadonlySet<string>,
): MedicationCandidateWire[] {
  return candidates.filter((candidate) => !resolved.has(candidateKey(candidate)))
}

/**
 * The stretch of the dictation that belongs to one accepted drug.
 *
 * **The parse endpoint returns one sig for the whole phrase**, so accepting four
 * drugs cannot take four sigs from one response. Re-parsing this slice is what
 * gives each drug the dose that was actually said beside it, and the alternative
 * of reusing the whole-phrase sig is how paracetamol's 500 mg lands on
 * cetirizine. D-001 exists to prevent exactly that.
 *
 * **It starts at the drug's own name and ends at the next drug name heard.** A
 * rejected or still-open candidate is still evidence that a different drug
 * starts there, so every candidate bounds the end regardless of what the doctor
 * did with it.
 *
 * **Starting at the previous drug's end instead was tried and is wrong.** It
 * would catch a dose stated before the name, as in "500 mg of amoxicillin", but
 * dictation almost always states the sig after the name, so the slice for drug
 * two would open with drug one's trailing "500 mg three times a day" and the
 * parser would read it. Losing a leading dose costs an empty field, which asks
 * the doctor a question; inheriting the previous drug's dose fills the field
 * with an answer nobody gave. The asymmetry is the whole reason this function
 * exists, so it fails toward the empty field.
 *
 * The `> candidate.end` test rather than `> candidate.start` is what keeps a
 * combination such as `amoxicillin-clavulanate` from being cut short by the
 * `amoxicillin` the matcher also finds inside it.
 *
 * It reads from the text the offsets belong to, never from the live box, so a
 * doctor mid-edit cannot move the slice under the row.
 */
export function spanForCandidate(
  parsedFrom: string,
  candidates: readonly MedicationCandidateWire[],
  candidate: MedicationCandidateWire,
): Span {
  let to: number | null = null
  for (const other of candidates) {
    /*
     * A later mention of the same drug does not bound it. Self-correction is
     * ordinary speech, and "amoxicillin, sorry, amoxicillin 500 mg" offers two
     * candidates for one drug: bounding the first at the second cut its slice
     * to "amoxicillin, sorry," and recorded the dose as unread.
     */
    if (other.lexiconId === candidate.lexiconId) continue
    if (other.start > candidate.end && (to === null || other.start < to)) to = other.start
  }
  return { start: candidate.start, end: to ?? parsedFrom.length }
}

/** The text of {@link spanForCandidate}, which is what the row quotes. */
export function sliceForCandidate(
  parsedFrom: string,
  candidates: readonly MedicationCandidateWire[],
  candidate: MedicationCandidateWire,
): string {
  const { start, end } = spanForCandidate(parsedFrom, candidates, candidate)
  return parsedFrom.slice(start, end).trim()
}

/**
 * Narrow a claimed span to the last character its sig parse could account for.
 *
 * **This is what leaves a remainder to show.** A slice bounded only by the next
 * drug name runs to the end of the dictation whenever the matcher offered no
 * next name, and a brand name is outside the lexicon by D-001, so that is the
 * ordinary case rather than the rare one. Without narrowing, one row claims
 * every character and `unclaimedStretches` can never return anything (#369).
 *
 * **It only ever shrinks.** `readTo` is an offset into the slice, not into the
 * dictation, so it is measured from `span.start`; a `readTo` reaching past the
 * span means the parse read nothing this span does not already hold, and the
 * span stands. `null` likewise leaves it alone: no field was read, so there is
 * no evidence about where the drug's own text stops, and guessing a boundary
 * would cut a quote on nothing.
 */
export function narrowToSig(span: Span, readTo: number | null | undefined): Span {
  if (readTo === null || readTo === undefined) return span
  const end = span.start + readTo
  return end < span.end ? { start: span.start, end } : span
}

/**
 * The stretches of the dictation that no row claims.
 *
 * **A gap is evidence, never a proposal.** It says these characters belong to
 * no prescription, and nothing more: no drug name is read out of it, and none
 * is guessed. That distinction is what keeps this the visible-drop fix rather
 * than a second route to a drug name the doctor did not choose (D-001).
 *
 * A gap holding no letter is dropped, because the tail between one drug's sig
 * and the next drug's name is usually `. ` and offering it would be noise.
 */
export function unclaimedStretches(
  parsedFrom: string,
  claims: readonly Span[],
): { start: number; end: number; text: string }[] {
  const ordered = [...claims].sort((a, b) => a.start - b.start)
  const stretches: { start: number; end: number; text: string }[] = []
  let cursor = 0

  for (const claim of [...ordered, { start: parsedFrom.length, end: parsedFrom.length }]) {
    if (claim.start > cursor) {
      const gap = parsedFrom.slice(cursor, claim.start)
      /*
       * Leading punctuation is the previous drug's full stop rather than this
       * stretch's own text, so the offer opens on a word. The span moves with
       * it, which keeps `text` exactly what `parsedFrom` holds between the
       * bounds reported.
       */
      const lead = gap.length - gap.replace(/^[\s.,;:]+/, '').length
      const text = gap.slice(lead).trimEnd()
      if (/\p{L}/u.test(text)) {
        stretches.push({ start: cursor + lead, end: cursor + lead + text.length, text })
      }
    }
    cursor = Math.max(cursor, claim.end)
  }

  return stretches
}

/**
 * `PrescriptionSchema.dictated` is `max(2000)`; the box stops rather than the
 * API.
 *
 * **Raised from 400 on 10/09/26 (#365).** At 400 the cap bound a four-drug
 * prescription mid-sentence: the reported dictation was about 388 characters and
 * stopped at "; patient". The session cap in `backend/src/lib/asr/soniox.ts`
 * moved with it, because raising only this one moves the wall to the 300 second
 * bound, which surfaces as a dropped connection rather than as a limit.
 */
export const MAX_DICTATED_CHARACTERS = 2000

/**
 * Joins what was already in the box to what the stream has settled, bounded by
 * the field's own limit.
 *
 * **It cuts at a word boundary, never mid-word.** `dictated` is the evidence
 * field the sig was parsed from and the doctor reads it back to check the
 * parse, so half a drug name there is worse than a short quote.
 *
 * **`capped` is what stops the session**, not just the text. A stream that
 * keeps billing while its words are discarded is spend with no product, on a
 * path `.claude/rules/security.md` records as having no global budget.
 */
export function capDictation(
  prefix: string,
  streamed: string,
  limit: number,
): { text: string; capped: boolean } {
  const joined = prefix.length > 0 ? `${prefix.trimEnd()} ${streamed}` : streamed
  if (joined.length <= limit) return { text: joined, capped: false }

  const cut = joined.slice(0, limit)
  const boundary = cut.lastIndexOf(' ')
  /*
   * No boundary means the very first token is longer than the whole budget, so
   * there is no whole word to keep. It yields nothing rather than a fragment:
   * the invariant that this field never shows a partial drug name is worth more
   * than salvaging characters, and at a 2000 character limit the branch needs a
   * single unbroken 2000 character word to reach it at all.
   */
  return { text: boundary > 0 ? cut.slice(0, boundary).trimEnd() : '', capped: true }
}

/** `every-6-hours` reads as `Every 6 Hours`. Labels are Title Case (docs/DESIGN.md). */
export const titleCase = (value: string) =>
  value.replace(/-/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase())

/** The one set whose bare values are ambiguous: "before" what? */
export const FOOD_LABELS: Record<SigFoodTiming, string> = {
  before: 'Before Food',
  after: 'After Food',
  with: 'With Food',
}

const optionsFor = <T extends string>(
  values: readonly T[],
  label: (value: T) => string,
): SelectOption[] => [
  { value: '', label: 'Not Specified' },
  ...values.map((value) => ({ value, label: label(value) })),
]

export const ROUTE_OPTIONS = optionsFor(SIG_ROUTES, titleCase)
export const FREQUENCY_OPTIONS = optionsFor(SIG_FREQUENCIES, titleCase)
export const FOOD_OPTIONS = optionsFor(SIG_FOOD_TIMINGS, (value) => FOOD_LABELS[value])

/** The sig fields as they arrive from the parser, `null` becoming "not specified". */
export function fromSig(
  sig: PrescriptionParseResponse['sig'],
): Omit<PrescriptionDraft, 'drug' | 'lexiconId'> {
  return {
    dose: sig.dose ?? '',
    route: sig.route ?? '',
    frequency: sig.frequency ?? '',
    duration: sig.duration ?? '',
    food: sig.food ?? '',
  }
}

/** One line of sig, for a row the doctor is scanning rather than editing. */
export function summarise(prescription: Prescription | PrescriptionDraft) {
  const value = <T>(part: T | '' | null): T | null => (part === '' || part === null ? null : part)
  return [
    value(prescription.dose),
    value(prescription.route) === null ? null : titleCase(prescription.route as string),
    value(prescription.frequency) === null ? null : titleCase(prescription.frequency as string),
    value(prescription.food) === null ? null : FOOD_LABELS[prescription.food as SigFoodTiming],
    value(prescription.duration) === null ? null : `for ${prescription.duration}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}
