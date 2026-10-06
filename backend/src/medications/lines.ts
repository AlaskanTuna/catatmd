import { type PrescriptionLine, SHAREABLE_SIG_FIELDS, type ShareableSigField } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import { type MedicationCandidate, matchMedication } from './match.js'
import { parseSigWithSpan, type Sig } from './sig.js'
import { SIG_STOPWORDS, SPOKEN_NUMERALS } from './vocabulary.js'

/**
 * Cuts one dictated prescription into lines, one per drug said
 * (`docs/decisions.md` D-001, amended 06/10/26).
 *
 * **It reads clauses, then decides who each one belongs to.** A clause naming a
 * drug starts that drug's line. A clause with no drug name either continues the
 * line before it ("three times a day"), is shared by every line ("all of them
 * twice a day"), or is a line of its own that nobody named ("antibiotic 200
 * mg"). The last is returned with no candidates, so the doctor sees it rather
 * than finding its dose folded into a neighbour.
 *
 * **It never proposes a drug.** A line's candidates are the matcher's, untouched
 * and in the matcher's order; an unnamed line carries none.
 *
 * Pure functions: no I/O, no clock, no randomness.
 */

type Span = { start: number; end: number }

type Cluster = Span & { readonly members: readonly MedicationCandidate[] }

type Item = Span & {
  readonly kind: 'drug' | 'unnamed' | 'shared'
  readonly cluster: readonly MedicationCandidate[]
  /** Said in one clause with another drug, so where its dose belongs is a guess. */
  readonly crowded?: boolean
}

/**
 * Where one clause ends: punctuation followed by a space, a full stop that is
 * not a decimal point, a new line, or a joining word. A boundary inside a drug
 * name is ignored, so "amoxicillin and clavulanic acid" stays one name.
 */
const BOUNDARY = /[,;]\s+|\.(?=\s|$)|\n+|\s+(?:and|dan|then|plus|also)\s+/giu

/**
 * A clause opening on "all of them", "both" or "semua" may speak for every line
 * (`sharesAcross` decides).
 */
const SHARED =
  /^(?:(?:take|ambil|makan|give|for)\s+)?(?:all|both|semua|kesemua|kedua(?:[\s-]+dua)?)(?:nya)?(?:\s+of\s+(?:them|these|those))?\b/iu

/**
 * An amount counted in puffs, sprays, drops or lozenges. `parseSig` reads none
 * of them as a dose, and changing that would change every stored sig, so it is
 * read here only to decide where a line starts: "nasal spray, two puffs" after
 * a dosed drug is another drug, not more of the same one.
 */
const COUNTED = new RegExp(
  `\\b(?:\\d+|${[...SPOKEN_NUMERALS.keys()].join('|')})\\s+(?:puffs?|sprays?|drops?|lozenges?)\\b`,
  'iu',
)

/** A dosage form, which makes a clause naming nothing else a product named. */
const FORM =
  /\b(?:lozenges?|syrup|spray|cream|ointment|gel|drops|inhaler|gargle|mouthwash|suspension)\b/iu

/** `PrescriptionLineSchema` bounds a line's candidates; the best come first. */
const MAX_LINE_CANDIDATES = 20

/** The matcher's own bar: shorter words are abbreviations, never drug names. */
const MIN_NAME_LENGTH = 4

/** Words a doctor opens a continuation with, which name no drug. */
const FILLER: ReadonlySet<string> = new Set([
  'please',
  'okay',
  'sorry',
  'give',
  'patient',
  'them',
  'these',
  'those',
  'that',
  'this',
  'just',
  'start',
  'continue',
  'ambil',
  'beri',
])

const slice = (text: string, span: Span) => text.slice(span.start, span.end)

const trimmed = (text: string, span: Span): Span => {
  const part = slice(text, span)
  const lead = part.length - part.trimStart().length
  return { start: span.start + lead, end: span.start + part.trimEnd().length }
}

const sigOf = (text: string, span: Span) => parseSigWithSpan(slice(text, span))

const saysAnything = (sig: Sig) => Object.values(sig).some((value) => value !== null)

/** A dose as `parseSig` reads one, or an amount it does not read as one. */
const dosed = (text: string, span: Span) =>
  sigOf(text, span).sig.dose !== null || COUNTED.test(slice(text, span))

/**
 * Overlapping candidates are one drug name heard once, with alternatives. The
 * members keep the matcher's order, so the first is its best reading.
 */
function clustersOf(candidates: readonly MedicationCandidate[]): Cluster[] {
  let clusters: Cluster[] = []
  for (const candidate of candidates) {
    const touching = clusters.filter(
      (cluster) => candidate.start < cluster.end && cluster.start < candidate.end,
    )
    const members = [...touching.flatMap((cluster) => cluster.members), candidate].sort(
      (a, b) => candidates.indexOf(a) - candidates.indexOf(b),
    )
    clusters = [
      ...clusters.filter((cluster) => !touching.includes(cluster)),
      {
        start: Math.min(candidate.start, ...touching.map((cluster) => cluster.start)),
        end: Math.max(candidate.end, ...touching.map((cluster) => cluster.end)),
        members,
      },
    ]
  }
  return clusters.sort((a, b) => a.start - b.start)
}

function clausesOf(text: string, clusters: readonly Cluster[]): Span[] {
  const clauses: Span[] = []
  let cursor = 0
  for (const match of text.matchAll(BOUNDARY)) {
    const start = match.index
    const end = start + match[0].length
    if (clusters.some((cluster) => start < cluster.end && cluster.start < end)) continue
    clauses.push({ start: cursor, end: start })
    cursor = end
  }
  clauses.push({ start: cursor, end: text.length })
  return clauses.map((clause) => trimmed(text, clause)).filter(({ start, end }) => end > start)
}

/**
 * Whether a clause with a sig opens on a word the sig does not own, which may
 * be a drug the lexicon does not know: "antibiotic 200 mg", or a brand name.
 * Read only before the first sig field, so "as needed for fever" is not one.
 */
function opensOnAnotherName(text: string, span: Span): boolean {
  const { readFrom } = sigOf(text, span)
  if (readFrom === null) return false
  const words =
    slice(text, span)
      .slice(0, readFrom)
      .toLowerCase()
      .match(/\p{L}+/gu) ?? []
  return words.some(
    (word) => word.length >= MIN_NAME_LENGTH && !SIG_STOPWORDS.has(word) && !FILLER.has(word),
  )
}

/** Any word the sig does not own, which is how a name nobody recognised looks. */
function namesWord(part: string): boolean {
  const words = part.toLowerCase().match(/\p{L}+/gu) ?? []
  return words.some(
    (word) => word.length >= MIN_NAME_LENGTH && !SIG_STOPWORDS.has(word) && !FILLER.has(word),
  )
}

const namesSomething = (text: string, span: Span) => namesWord(slice(text, span))

/**
 * Whether a clause opening on a shared word speaks for every line. Only when
 * nothing names what it counts: "both twice daily" does, "both nostrils twice
 * daily" is one spray's own instruction.
 */
function sharesAcross(text: string, clause: Span): boolean {
  const part = slice(text, clause)
  const marker = SHARED.exec(part)
  if (marker === null) return false
  const { readFrom } = parseSigWithSpan(part)
  return !namesWord(part.slice(marker[0].length, readFrom ?? part.length))
}

/**
 * Whether every field a clause says is one its line already has: a second sig
 * in one breath, which is a second drug. "As needed" beside a regular frequency
 * is the one pairing that is not a repeat, because PRN qualifies a schedule.
 */
function repeatsOnly(said: Sig, own: Sig): boolean {
  const fields = (Object.keys(said) as (keyof Sig)[]).filter((field) => said[field] !== null)
  return (
    fields.length > 0 &&
    fields.every(
      (field) =>
        own[field] !== null &&
        !(
          field === 'frequency' &&
          (said.frequency === 'when-required') !== (own.frequency === 'when-required')
        ),
    )
  )
}

/**
 * Where a heard name starts: its best reading, not the cluster's widest. A
 * fuzzy window can reach back over a unit, as "g amoxicillin" does, and
 * starting the line there would hand the unit's number to the wrong drug.
 */
const nameStart = (cluster: Cluster) => cluster.members[0]?.start ?? cluster.start

/**
 * Places each clause on a line. A clause with no drug name in it continues the
 * line before it unless it carries evidence of another drug:
 *
 * - **a dose** when that line already has one, or after a word the sig does not
 *   own, as in "antibiotic 200 mg"
 * - **only fields that line already has**, as the second drug in "Strepsils
 *   lozenge, oral, every 4 hours" repeats a route and a frequency
 *
 * Either starts a line nobody named. A clause just before it that named
 * something and said no sig, such as "Strepsils lozenge", moves with it.
 */
function cut(text: string, clusters: readonly Cluster[]): Item[] {
  const items: Item[] = []
  /**
   * The last clause appended that named something and said nothing else.
   * `product` when it named a form as well, as "Strepsils lozenge" does.
   */
  let tail: { item: Item; end: number; start: number; product: boolean } | null = null

  const extend = (item: Item, clause: Span) => {
    item.end = clause.end
  }

  const startUnnamed = (clause: Span, before: typeof tail) => {
    let start = clause.start
    if (before !== null && before.item === items.at(-1)) {
      before.item.end = before.end
      start = before.start
    }
    items.push({ kind: 'unnamed', start, end: clause.end, cluster: [] })
  }

  const placeUnnamed = (clause: Span) => {
    const { sig } = sigOf(text, clause)
    const current = items.at(-1)
    const before = tail
    tail = null

    if (sharesAcross(text, clause)) {
      // A dose is never shared, and never dropped either: it becomes its own line.
      if (dosed(text, clause)) startUnnamed(clause, before)
      else items.push({ kind: 'shared', ...clause, cluster: [] })
      return
    }

    if (dosed(text, clause)) {
      /*
       * A dose joins a drug still waiting for one, unless something else was
       * named in between: in "Paracetamol, Brufen, 400 mg" the 400 mg is
       * Brufen's, and paracetamol's dose stays empty rather than inherited.
       */
      if (
        current?.kind === 'drug' &&
        before === null &&
        !dosed(text, current) &&
        !opensOnAnotherName(text, clause)
      ) {
        return extend(current, clause)
      }
      return startUnnamed(clause, before)
    }

    if (current === undefined) {
      if (saysAnything(sig)) startUnnamed(clause, null)
      return
    }
    /*
     * A sig straight after a product named is that product's, not the line
     * before's: "Strepsils lozenge, oral, every 4 hours". A bare word such as
     * "wrote" is not enough, because the recogniser leaves those mid-sig.
     */
    if (before?.product === true && saysAnything(sig)) return startUnnamed(clause, before)
    if (current.kind !== 'shared' && repeatsOnly(sig, sigOf(text, current).sig)) {
      return startUnnamed(clause, before)
    }
    if (!saysAnything(sig) && namesSomething(text, clause)) {
      tail = {
        item: current,
        end: current.end,
        start: clause.start,
        product: FORM.test(slice(text, clause)),
      }
    }
    extend(current, clause)
  }

  const placeClause = (clause: Span) => {
    const named = clusters.filter(
      (cluster) => nameStart(cluster) >= clause.start && nameStart(cluster) < clause.end,
    )
    const first = named[0]
    if (first === undefined) return placeUnnamed(clause)
    tail = null

    /*
     * Text before the first name in a clause is usually that drug's own dose,
     * as in "500 mg of amoxicillin". It is split off only when it opens on
     * another word with a sig after it, as in "Panadol 1 g amoxicillin 500 mg",
     * where keeping it would put 1 g on amoxicillin.
     */
    let opening = clause.start
    const lead = trimmed(text, { start: clause.start, end: nameStart(first) })
    if (lead.end > lead.start && opensOnAnotherName(text, lead)) {
      placeUnnamed(lead)
      tail = null
      opening = nameStart(first)
    }

    named.forEach((cluster, index) => {
      const next = named[index + 1]
      const crowded = named.length > 1
      const span = trimmed(text, {
        start: index === 0 ? opening : nameStart(cluster),
        end: next === undefined ? clause.end : nameStart(next),
      })
      const current = items.at(-1)
      /*
       * The same drug said again before any dose is one line, not two:
       * "amoxicillin, sorry, amoxicillin 500 mg" is a self-correction. Only
       * when both are heard exactly: "Cefuroxime, cefixime 200 mg" reads the
       * second as cefuroxime too, and merging them would hand cefixime's dose
       * to the look-alike.
       */
      if (
        current?.kind === 'drug' &&
        current.cluster[0]?.lexiconId === cluster.members[0]?.lexiconId &&
        isExact(text, current.cluster) &&
        isExact(text, cluster.members) &&
        !dosed(text, current)
      ) {
        extend(current, span)
        return
      }
      items.push({ kind: 'drug', ...span, cluster: cluster.members, crowded })
    })
  }

  for (const clause of clausesOf(text, clusters)) placeClause(clause)
  return items
}

/**
 * Exact only when the best reading is the name as heard and no other reading
 * reaches past it over another word. "amoxicillin and clavulanic acid" also
 * offers the combination across "clavulanic", so the plain amoxicillin inside
 * it is never exact: the single agent outranking the combination is the #311
 * finding. Reaching over a unit, as "g amoxicillin" does, is not another word.
 */
function isExact(text: string, cluster: readonly MedicationCandidate[]): boolean {
  const [best, ...rest] = cluster
  if (best === undefined || best.score !== 1) return false
  return rest.every((other) => {
    const beyond = `${text.slice(other.start, best.start)} ${text.slice(best.end, other.end)}`
    const words = beyond.toLowerCase().match(/\p{L}+/gu) ?? []
    return words.every((word) => word.length < MIN_NAME_LENGTH || SIG_STOPWORDS.has(word))
  })
}

function fill<K extends ShareableSigField>(
  target: { [F in keyof Sig]: Sig[F] },
  from: Sig,
  field: K,
) {
  target[field] = from[field]
}

/**
 * `candidates` may be passed in when the caller has already matched, since the
 * matcher is the expensive half and a route answering both shapes needs it once.
 */
export function parsePrescriptionLines(
  text: string,
  profileId?: ProfileId,
  candidates: readonly MedicationCandidate[] = matchMedication(text, profileId),
): PrescriptionLine[] {
  const items = cut(text, clustersOf(candidates))

  const shared = items
    .filter(({ kind }) => kind === 'shared')
    .map((item) => ({ item, sig: sigOf(text, item).sig }))

  return items
    .filter(({ kind }) => kind !== 'shared')
    .map((item) => {
      const own = sigOf(text, item).sig
      const sig = { ...own }
      const provenance: PrescriptionLine['shared'] = []
      for (const field of SHAREABLE_SIG_FIELDS) {
        if (own[field] !== null) continue
        const source = shared.find((clause) => clause.sig[field] !== null)
        if (source === undefined) continue
        fill(sig, source.sig, field)
        provenance.push({ field, start: source.item.start, end: source.item.end })
      }
      return {
        start: item.start,
        end: item.end,
        candidates: item.cluster.slice(0, MAX_LINE_CANDIDATES),
        // Two names in one breath leave each dose's owner a guess, so neither
        // line is ticked for the doctor: "amoxicillin tds 1 g paracetamol".
        exact: isExact(text, item.cluster) && item.crowded !== true,
        sig,
        shared: provenance,
      }
    })
}
