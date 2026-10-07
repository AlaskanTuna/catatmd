import {
  type MedicationCandidateWire,
  type Prescription,
  type PrescriptionLine,
  type PrescriptionParseResponse,
  type ShareableSigField,
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

/**
 * Take a lexicon candidate as the drug name on a line's draft.
 *
 * **The draft is an offer until the line is ticked**, and only a ticked line is
 * saved. Since D-001's 06/10/26 amendment an exact name starts ticked, so
 * Confirm accepts it; a near-match never does, and waits for the doctor's own
 * tick.
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

/** A half-open range of the parsed text, in characters. */
export type Span = { readonly start: number; readonly end: number }

/**
 * What the doctor has done to one line, kept apart from what the parse read.
 *
 * **Kept apart so a re-parse cannot overwrite it.** The box re-parses as the
 * doctor edits it, and a dose they typed must survive the text being read
 * again. Each key is set only by the doctor's own act.
 */
export type LineEdit = {
  readonly ticked?: boolean
  /** Typed by hand, which drops the lexicon provenance with it. */
  readonly drug?: string
  /** Another of the line's own candidates, picked over the first. */
  readonly chosen?: string
  readonly fields?: Partial<Omit<PrescriptionDraft, 'drug' | 'lexiconId'>>
}

/**
 * One row of the Prescription Lines table.
 *
 * `heard` came from a drug name the matcher recognised; `unnamed` is a line
 * with a sig but no recognised name, which must be named or unticked before
 * Confirm; `manual` was added by hand.
 */
export type LineRow = {
  readonly key: string
  readonly kind: 'heard' | 'unnamed' | 'manual'
  /** Where the line sits in the parsed text. Absent on a manual row. */
  readonly span?: Span
  readonly candidates: readonly MedicationCandidateWire[]
  readonly exact: boolean
  readonly draft: PrescriptionDraft
  /** Fields still filled from a shared clause, with where that clause sits. */
  readonly shared: readonly { field: ShareableSigField; start: number; end: number }[]
  readonly ticked: boolean
  /**
   * A reading the matcher had to guess at, which the doctor has neither taken
   * nor left out yet. It holds Confirm: a drug said and then dropped because
   * nobody ticked it is the #369 failure by another door.
   */
  readonly undecided: boolean
  /** What travels as `dictated`: this line's own words, and any shared clause it used. */
  readonly evidence: string
}

const normalised = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * A key per line that survives the text being parsed again.
 *
 * By drug for a heard line and by its words for an unnamed one, counted in
 * order so a drug said twice keeps two keys. Offsets would not do: correcting
 * one word early in the box moves every line after it.
 */
export function lineKeys(parsedFrom: string, lines: readonly PrescriptionLine[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const base =
      line.candidates[0] === undefined
        ? `unnamed:${normalised(parsedFrom.slice(line.start, line.end))}`
        : `heard:${line.candidates[0].lexiconId}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return `${base}:${count}`
  })
}

/**
 * The table, from the parse and the doctor's edits.
 *
 * **A near-match is never ticked for the doctor** (`docs/decisions.md` D-001,
 * amended 06/10/26). Only an exact name starts ticked, so pressing Confirm
 * accepts it; a reading the matcher had to guess at is undecided until the
 * doctor ticks it, picks another reading, types a name or leaves it out. An
 * unnamed line starts ticked, so Confirm stays held until the doctor names it
 * or unticks it.
 */
export function rowsFrom(
  parsedFrom: string,
  lines: readonly PrescriptionLine[],
  edits: ReadonlyMap<string, LineEdit>,
): LineRow[] {
  const keys = lineKeys(parsedFrom, lines)
  return lines.map((line, index) => {
    const key = keys[index] as string
    const edit = edits.get(key) ?? {}
    const pick =
      line.candidates.find(({ lexiconId }) => lexiconId === edit.chosen) ?? line.candidates[0]

    let draft: PrescriptionDraft = { ...EMPTY_DRAFT, ...fromSig(line.sig) }
    if (pick !== undefined) draft = acceptCandidate(draft, pick)
    if (edit.drug !== undefined) draft = setDrugByHand(draft, edit.drug)
    draft = { ...draft, ...edit.fields }

    const shared = line.shared.filter(({ field }) => edit.fields?.[field] === undefined)
    const quotes = [
      parsedFrom.slice(line.start, line.end),
      ...new Set(shared.map(({ start, end }) => parsedFrom.slice(start, end))),
    ]

    return {
      key,
      kind: pick === undefined ? 'unnamed' : 'heard',
      span: { start: line.start, end: line.end },
      candidates: line.candidates,
      exact: line.exact,
      draft,
      shared,
      ticked: edit.ticked ?? (pick === undefined || line.exact || edit.drug !== undefined),
      undecided:
        pick !== undefined &&
        !line.exact &&
        edit.ticked === undefined &&
        edit.chosen === undefined &&
        edit.drug === undefined,
      evidence: evidenceOf(quotes),
    }
  })
}

/**
 * The line's own words, then the shared clause it used, within the field's
 * limit. Past it the shared quote goes rather than half a word.
 */
const evidenceOf = (quotes: readonly string[]) => {
  const joined = quotes.join(' … ')
  return joined.length <= MAX_DICTATED_CHARACTERS ? joined : (quotes[0] ?? '')
}

/** A row added by hand, quoting the whole box as its evidence. */
export function manualRow(key: string, phrase: string, edit: LineEdit = {}): LineRow {
  return {
    key,
    kind: 'manual',
    candidates: [],
    exact: false,
    draft: { ...EMPTY_DRAFT, drug: edit.drug ?? '', ...edit.fields },
    shared: [],
    ticked: edit.ticked ?? true,
    undecided: false,
    evidence: phrase,
  }
}

/**
 * What Confirm would save, and what still holds it.
 *
 * Unticked rows the doctor left out are left out entirely. Nothing else is
 * left out quietly: a ticked row with no drug and a near-match nobody decided
 * on are both counted, and either count holds Confirm.
 */
export function toConfirm(rows: readonly LineRow[]): {
  ready: Prescription[]
  unnamed: number
  undecided: number
} {
  const ticked = rows.filter(({ ticked }) => ticked)
  const ready = ticked.flatMap((row) => {
    const prescription = toPrescription(row.draft, row.evidence)
    return prescription === null ? [] : [prescription]
  })
  return {
    ready,
    unnamed: ticked.length - ready.length,
    undecided: rows.filter(({ undecided }) => undecided).length,
  }
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
