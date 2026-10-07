import {
  GIVEN_NAMES,
  HAN_BEFORE_SURNAME,
  HAN_COMPOUND_SURNAMES,
  HAN_NAME_INTRODUCERS,
  HAN_SURNAME_INTRODUCERS,
  HAN_SURNAMES,
  HAN_THIRD_PERSON_INTRODUCERS,
  HAN_TITLES,
  HONORIFICS,
  NAME_INTRODUCERS,
  NAME_STOPWORDS,
  PATRONYMICS,
  TAMIL_NAME_INTRODUCERS,
  TAMIL_TITLES,
} from './gazetteer.js'
import { isStructurallyValidNric, NRIC_PATTERN, NRIC_UNHYPHENATED_PATTERN } from './nric.js'

/**
 * Detector inventory for the Malaysian context (docs/trd.md §9).
 *
 * Detectors are `pattern + score + context`, matching Microsoft Presidio's
 * `PatternRecognizer` contract rather than flat boolean regex: a low-confidence
 * match is **promoted** when a context word appears nearby and demoted
 * otherwise. That shape is the industry standard and citable as such, which
 * matters for a component whose recall cannot be guaranteed.
 *
 * This is not a clinical-grade NER system and is not presented as one. See
 * docs/prd.md §12 — pattern detectors may miss an unmarked name, and the
 * published evidence says an ML NER would miss Malay names disproportionately
 * too. Raw transcripts are therefore still treated as sensitive at rest.
 */

export type DetectorLabel =
  | 'PATIENT'
  | 'NRIC'
  | 'PHONE'
  | 'ADDRESS'
  | 'DOB'
  | 'MRN'
  | 'EMAIL'
  | 'SCRIPT'

export interface Match {
  readonly label: DetectorLabel
  readonly start: number
  readonly end: number
  readonly value: string
  readonly score: number
}

/** Confidence at or above which a match is tokenised. */
export const ACCEPT_THRESHOLD = 0.5

const CONTEXT_WINDOW = 48
const CONTEXT_BOOST = 0.35

/**
 * Cue patterns, compiled once and matched on word boundaries (#159).
 *
 * `window.includes('ic')` was a substring test, so the NRIC cue `ic` fired
 * inside "invoice", "clinic", "medical" and "notice". A structurally invalid
 * bare twelve-digit number near any of those was boosted from 0.3 to 0.65 and
 * tokenised, while the same sentence ending in "receipt" was left alone.
 *
 * The cost was precision rather than a leak, because rehydration puts the value
 * back into the note. It is still worth closing: a vault carrying phantom NRICs
 * is noise in the one structure whose contents nobody may inspect to check.
 *
 * Lookarounds rather than `\b`, because several cues carry `/` (`i/c`, `k/p`)
 * and one carries a space (`kad pengenalan`). `\b` sits in a different place
 * relative to those characters than the cue needs.
 *
 * **Every cue list had to be re-read when this changed, and the lists below
 * carry inflected forms because of it.** Under substring matching `live` also
 * covered `lives`, `lived` and `living` for free. Under word matching it does
 * not, and ADDRESS scores 0.45 without a cue, which is under `ACCEPT_THRESHOLD`:
 * "She lives at Jalan Ampang 5" lost its address entirely and sent it onward in
 * cleartext. A tightening that looks like pure precision is a recall change
 * wherever a base score sits below the threshold on its own.
 */
const CUE_PATTERNS = new Map<string, RegExp>()

function cuePattern(cue: string): RegExp {
  const cached = CUE_PATTERNS.get(cue)
  if (cached) return cached
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const built = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
  CUE_PATTERNS.set(cue, built)
  return built
}

function hasContext(text: string, start: number, end: number, words: readonly string[]): boolean {
  const window = text.slice(
    Math.max(0, start - CONTEXT_WINDOW),
    Math.min(text.length, end + CONTEXT_WINDOW),
  )
  return words.some((w) => cuePattern(w).test(window))
}

function scoreWith(
  text: string,
  start: number,
  end: number,
  baseScore: number,
  contextWords: readonly string[],
): number {
  return hasContext(text, start, end, contextWords)
    ? Math.min(1, baseScore + CONTEXT_BOOST)
    : baseScore
}

// ─── NRIC ────────────────────────────────────────────────────────────────────

/*
 * Two kinds of entry, and the second kind is deliberate rather than incidental.
 *
 * **The `-nya` forms are enumerated, not inferred.** Malay attaches the
 * possessive clitic directly to the noun, so `pesakitnya`, `kad pengenalannya`
 * and `icnya` are ordinary rather than unusual. Substring matching covered them
 * for free and word matching covers none, and the failure is worse than a miss:
 * PHONE claims ten of the twelve digits and leaves two in the clear, which is a
 * partly tokenised identifier. `IC-nya` needs no entry, because the hyphen
 * already satisfies the lookahead.
 *
 * **The clinical-setting words are here on purpose, and used not to be.** A
 * structurally invalid twelve-digit run scores 0.3 and clears `ACCEPT_THRESHOLD`
 * only with a cue. Under substring matching, `ic` fired inside "clinic",
 * "medical", "physician" and "pediatric", so those runs were masked by accident.
 * Fixing the substring bug removed the accident and with it the masking: "At the
 * clinic, 990231145677 was recorded" sent all twelve digits onward.
 *
 * A structurally invalid NRIC is not only an invoice number. It is also the
 * ordinary shape of a real NRIC that transcription got wrong, and hosted ASR
 * (#154) sits in front of this detector, which makes garbled digits more likely
 * rather than less. So the incidental behaviour is made explicit: in a clinical
 * transcript, a long digit run beside these words is more likely an identifier
 * than a reference number, and the repository's own rule is that a recall loss
 * on the boundary outranks a precision gain.
 *
 * The distinction #159 actually fixed survives: `invoice`, `notice` and
 * `receipt` are not clinical words and are not cues, so they no longer boost
 * anything. What changed is that the cue has to be a word.
 */
const NRIC_CONTEXT = [
  'ic',
  'icnya',
  'i/c',
  'k/p',
  'nric',
  'mykad',
  'mykadnya',
  'kad pengenalan',
  'kad pengenalannya',
  'identity',
  'pesakit',
  'pesakitnya',
  'clinic',
  'klinik',
  'medical',
  'physician',
]

function detectNric(text: string): Match[] {
  const out: Match[] = []
  for (const m of text.matchAll(NRIC_PATTERN)) {
    const value = m[0]
    const start = m.index
    // Structural validity is precision, not recall: an implausible NRIC still
    // scores high enough to be tokenised when the context says it is one.
    const base = isStructurallyValidNric(value) ? 0.85 : 0.4
    out.push({
      label: 'NRIC',
      start,
      end: start + value.length,
      value,
      score: scoreWith(text, start, start + value.length, base, NRIC_CONTEXT),
    })
  }
  // Hyphens do not survive speech or casual typing. A structurally valid bare
  // twelve-digit run gates with no context at all (recall-first: transcription
  // puts digits far from the "IC" that introduced them), and validity bounds
  // the false positives: a random twelve-digit reference number rarely carries
  // a real birth date plus an assigned place-of-birth code. An invalid one
  // needs the context boost, mirroring the mistyped-IC philosophy above.
  for (const m of text.matchAll(NRIC_UNHYPHENATED_PATTERN)) {
    const value = m[0]
    const start = m.index
    const base = isStructurallyValidNric(value) ? 0.55 : 0.3
    out.push({
      label: 'NRIC',
      start,
      end: start + value.length,
      value,
      score: scoreWith(text, start, start + value.length, base, NRIC_CONTEXT),
    })
  }
  return out
}

// ─── Phone ───────────────────────────────────────────────────────────────────

const PHONE_PATTERN =
  /(?:\+?60[\s-]?)?0?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b|\b0\d[\s-]?\d{3,4}[\s-]?\d{4}\b/g
const PHONE_CONTEXT = [
  'phone',
  'telephone',
  'call',
  'called',
  'contact',
  'contacts',
  'hp',
  'handphone',
  'mobile',
  'telefon',
  'number',
  'numbers',
  'nombor',
]

function detectPhone(text: string): Match[] {
  const out: Match[] = []
  for (const m of text.matchAll(PHONE_PATTERN)) {
    const value = m[0].trim()
    const start = m.index
    const digits = value.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 12) continue
    out.push({
      label: 'PHONE',
      start,
      end: start + value.length,
      value,
      score: scoreWith(text, start, start + value.length, 0.55, PHONE_CONTEXT),
    })
  }
  return out
}

// ─── Email ───────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

function detectEmail(text: string): Match[] {
  return [...text.matchAll(EMAIL_PATTERN)].map((m) => ({
    label: 'EMAIL' as const,
    start: m.index,
    end: m.index + m[0].length,
    value: m[0],
    score: 0.95,
  }))
}

// ─── Unreadable script ───────────────────────────────────────────────────────

/**
 * Any run of Bengali, Arabic or Devanagari script (#391).
 *
 * Every other detector here reads Latin script, so a name written in one of
 * these passes them untouched, and `assertNoIdentifiers` re-runs the same
 * detectors and shares the gap. Two-way translation (docs/trd.md §20.12) makes
 * Bengali and Urdu a designed part of the product for the first time; the SPA
 * keeps them out of model-bound text, and this is the same rule at the gate
 * itself, whatever a client sends. The whole run is one span, because nothing
 * here can tell a name inside it from the words around it, so a sentence in
 * one of these scripts reaches the model as a single token.
 *
 * Devanagari is here because a recogniser may write Urdu speech in it.
 * **Chinese and Tamil are deliberately not**, although the same gap applies:
 * ambient capture hints both, and tokenising every Mandarin sentence would
 * blind the note to consultations that work today. That gap is recorded in
 * docs/trd.md §20.12 rather than closed here.
 */
const SCRIPT_CHARACTERS =
  '\\u0980-\\u09FF\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u0900-\\u097F'
// Whitespace, joiners, direction marks and ordinary punctuation between two
// script words stay inside the run, so a phrase is one token rather than one
// per clause, and an Urdu name split by a right-to-left mark stays one name.
const SCRIPT_JOIN = `[\\s\\u200C-\\u200F,.;:!?'"()-]+`
/*
 * Up to three Latin words with script on both sides join the run too, found in
 * review: "میرا نام عمران chowdhury شاہ ہے" left the lowercase surname between
 * two tokens, where no Latin detector reads a lowercase name. The cost is an
 * English word inside a script sentence going with it, which is the trade this
 * module makes. The join around them stays on one line and inside one clause,
 * so the `Patient:` label of the next transcript line is never swallowed.
 */
const ISLAND_JOIN = `[ \\t\\u00A0\\u200C-\\u200F,'"()-]+`
const SCRIPT_RUN = new RegExp(
  `[${SCRIPT_CHARACTERS}]+(?:${SCRIPT_JOIN}[${SCRIPT_CHARACTERS}]+|${ISLAND_JOIN}(?:[A-Za-z][A-Za-z'-]*${ISLAND_JOIN}){1,3}[${SCRIPT_CHARACTERS}]+)*`,
  'gu',
)

function detectScript(text: string): Match[] {
  return [...text.matchAll(SCRIPT_RUN)].map((m) => ({
    label: 'SCRIPT' as const,
    start: m.index,
    end: m.index + m[0].length,
    value: m[0],
    score: 0.99,
  }))
}

// ─── Address ─────────────────────────────────────────────────────────────────

/**
 * A street-type keyword through to a 5-digit postcode, or the reverse.
 *
 * **The postcode branch is separate and required, because a lazy run followed
 * by an optional group never expands.** Written as one expression ending in
 * `(?:,\s*\d{5}...)?`, the `{2,40}?` always matched its two-character minimum
 * and stopped, so `Jalan Bukit Bintang 5, 50450 Kuala Lumpur` tokenised as
 * `Jalan Bu` and sent street, number, postcode and city onward in cleartext.
 * `hasPostcode` was consequently always false and the 0.8 branch below
 * unreachable, which is why every address depended entirely on a context cue.
 *
 * The city after the postcode is bounded to three words. `[A-Za-z\s]{2,25}`
 * ran through the sentence after it and, given the same address twice, joined
 * the first one to the second: one address became two tokens with the prose
 * between them deleted.
 *
 * Splitting it means the first alternative has to reach a postcode to match at
 * all, so the lazy run expands to find one.
 *
 * **The second alternative is bounded by case, not by a character count**
 * (#181). It too used to match its two-character minimum, so `Jalan Ampang 5,
 * Kuala Lumpur` tokenised as `Jalan Am` and left street, number and city in the
 * clear. A greedy `{2,40}` would have closed that and swallowed the clinical
 * prose after the street name, which is the worse trade: a tokenised span is
 * removed from what the model reads, so eating `and takes paracetamol 500 mg`
 * deletes the medication from the note the red-flag pass reasons over.
 *
 * What ends a street name structurally is the return to ordinary prose, and
 * ordinary prose is lower-case. `ADDRESS_ELEMENT` therefore admits only
 * elements opening with a capital or a digit, so the run stops dead at `and`,
 * `she`, `takes`. A full stop ends it for the same reason: `.` is deliberately
 * outside the element body, or `Taman Melati 3. She takes metformin` would run
 * `3.` into `She`. Separators are spaces and tabs only, never `\s`, so the run
 * cannot cross a line break into the next dictated turn.
 *
 * **The first element is exempt from the case rule** (`ADDRESS_FIRST_ELEMENT`),
 * and the exemption is a recall fix rather than an oversight. Requiring a
 * capital throughout meant `she lives at jalan ampang 5` matched nothing at
 * all, where the truncating version at least raised ADDRESS. That is a whole
 * address leaving the boundary rather than a partial one, so an all-lower-case
 * dictation would have been strictly worse off than before this fix. The street
 * type immediately precedes it, which is the anchor that makes the exemption
 * safe: the run still cannot start anywhere else, and every element after the
 * first is strict, so the prose bound is unchanged.
 *
 * **The `i` flag had to go for any of that to hold.** Under it `[A-Z]` matches
 * lower-case, which is the defect this file already carries a note about at
 * `caseInsensitiveLiteral`: the same flag is how the word "claim" was once
 * tokenised as a patient name. The street types keep their case-flexibility
 * through that helper instead, so the postcode branch is unchanged in meaning.
 */
const ADDRESS_ELEMENT = `[A-Z0-9][A-Za-z0-9'/-]*`
const ADDRESS_FIRST_ELEMENT = `[A-Za-z0-9][A-Za-z0-9'/-]*`
const ADDRESS_RUN = `${ADDRESS_FIRST_ELEMENT}(?:[ \\t]+${ADDRESS_ELEMENT}){0,5}(?:,[ \\t]*${ADDRESS_ELEMENT}(?:[ \\t]+${ADDRESS_ELEMENT}){0,3})?`
const STREET_TYPES = [
  'Jalan',
  'Jln',
  'Lorong',
  'Lrg',
  'Taman',
  'Tmn',
  'Kampung',
  'Kg',
  'Persiaran',
  'Lebuh',
]
const ADDRESS_PATTERN = new RegExp(
  `\\b(?:${caseInsensitiveLiteral('No')}\\.?\\s*\\d+[A-Za-z]?,?\\s*)?(?:${STREET_TYPES.map(caseInsensitiveLiteral).join('|')})\\s+(?:[A-Za-z0-9\\s./'-]{2,40}?,\\s*\\d{5}\\s*[A-Za-z]+(?:\\s+[A-Za-z]+){0,2}|${ADDRESS_RUN})`,
  'g',
)
/*
 * Inflected forms are enumerated, not inferred. ADDRESS has no cue-free route
 * over `ACCEPT_THRESHOLD` at base 0.45, so a cue that stops matching is a whole
 * address leaving the boundary rather than a score nudge. `lives`, `lived`,
 * `living`, `stays` and `staying` are all ordinary in a consultation note.
 */
const ADDRESS_CONTEXT = [
  'address',
  'addresses',
  'addressed',
  'addressing',
  'alamat',
  'alamatnya',
  'beralamat',
  'live',
  'lives',
  'lived',
  'living',
  'stay',
  'stays',
  'stayed',
  'staying',
  'tinggal',
  'tinggalnya',
  'duduk',
  'duduknya',
  'postcode',
  'postcodes',
  'poskod',
]

function detectAddress(text: string): Match[] {
  const out: Match[] = []
  for (const m of text.matchAll(ADDRESS_PATTERN)) {
    const value = m[0].trim().replace(/[,\s]+$/, '')
    const start = m.index
    const hasPostcode = /\d{5}/.test(value)
    out.push({
      label: 'ADDRESS',
      start,
      end: start + value.length,
      value,
      score: scoreWith(
        text,
        start,
        start + value.length,
        hasPostcode ? 0.8 : 0.45,
        ADDRESS_CONTEXT,
      ),
    })
  }
  return out
}

// ─── Date of birth ───────────────────────────────────────────────────────────

/**
 * A date is only PHI when it is a *birth* date — a consultation transcript is
 * full of other dates (symptom onset, follow-up) that must survive, because
 * tokenising them would destroy the clinical content the note depends on.
 * The DOB cue is therefore mandatory, not a score boost.
 */
const DOB_CUE =
  /(?:born(?:\s+on)?|date\s+of\s+birth|d\.?o\.?b\.?|birthday|(?:di|ke)?lahir(?:an|kan)?)\b/gi
// Malay months whose first three letters differ from the English abbreviation:
// Mac, Mei, Ogos, Okt(ober), Dis(ember). The rest already match via the
// English prefix plus `[a-z]*` (Januari, Februari, April, Jun, Julai, ...).
// The Malay alternates sit outside that `[a-z]*` so `Dis` cannot ride it into
// "discharge" or `Mac` into "macam".
const MONTH =
  /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*|Mac|Mei|Ogos|Okt(?:ober)?|Dis(?:ember)?/
const DATE_NEAR_CUE = new RegExp(
  `\\b(?:\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH.source})\\.?,?\\s+\\d{4}|(?:${MONTH.source})\\.?\\s+\\d{1,2},?\\s+\\d{4})\\b`,
  'gi',
)

function detectDob(text: string): Match[] {
  const out: Match[] = []
  for (const cue of text.matchAll(DOB_CUE)) {
    const windowStart = cue.index
    const windowEnd = Math.min(text.length, cue.index + cue[0].length + CONTEXT_WINDOW)
    const window = text.slice(windowStart, windowEnd)
    for (const d of window.matchAll(DATE_NEAR_CUE)) {
      const start = windowStart + d.index
      out.push({
        label: 'DOB',
        start,
        end: start + d[0].length,
        value: d[0],
        score: 0.85,
      })
    }
  }
  return out
}

// ─── Medical / clinic record number ──────────────────────────────────────────

/*
 * Cue directly before the value, and the separator is unchanged from before
 * this PR.
 *
 * **The filler run that #174 asked for was written, audited twice, and taken
 * back out.** It let "Registration number for our clinic file is KLC-004821"
 * match, which is the ordinary dictated phrasing and worth having. It also
 * masked clinical values inside a single sentence: "MRN unknown so I gave 500
 * mg" tokenised the dose. Two rounds of narrowing closed the sentence-crossing
 * cases and never closed that one, because a bounded run of ordinary words is
 * exactly what sits between a cue and an unrelated number in ordinary prose.
 *
 * Dose, age and symptom duration are what the model red-flag pass and gap
 * detection reason over. Masking them degrades that pass in the false-negative
 * direction, which `healthcare-cdss-patterns` holds to zero tolerance, and it
 * is a regression against a detector that was merely incomplete before. #174
 * stays open with the audit's reproducers on it rather than being closed by a
 * fix that trades a recall gap for a clinical-content gap.
 *
 * The value keeps the widened shape, which was clean across both audits: up to
 * three digit groups so `RC-2026-00842` is one match rather than `RC-2026` plus
 * orphaned digits, and a three-digit minimum on the first group so an age or a
 * tablet count cannot be one.
 */
const MRN_CUE =
  /\b(?:MRN|RN|record\s+(?:no|number)|registration\s+(?:no|number)|clinic\s+(?:no|number)|patient\s+(?:id|no|number)|file\s+(?:no|number)|(?:no\.?|nombor)\s+(?:pendaftaran|fail|klinik|pesakit))\b[:\s.#-]*([A-Z]{0,4}[-/]?\d{3,10}(?:[-/]?\d{2,10}){0,2}[A-Z]?)\b/gi

function detectMrn(text: string): Match[] {
  const out: Match[] = []
  for (const m of text.matchAll(MRN_CUE)) {
    const value = m[1]
    if (!value) continue
    const start = m.index + m[0].lastIndexOf(value)
    out.push({ label: 'MRN', start, end: start + value.length, value, score: 0.8 })
  }
  return out
}

// ─── Person name ─────────────────────────────────────────────────────────────

// Each word ends on a letter. Ending on `[a-z'-]` let a word like `A-` fail
// the trailing boundary and backtrack across the whole unbounded run, which is
// quadratic in its length. A trailing hyphen or apostrophe goes in the
// separator instead, so `Firdaus' Qaseh` stays one run.
const CAPITALISED_RUN = /\b[A-Z][a-z'-]*[a-z](?:['-]?\s+[A-Z][a-z'-]*[a-z])*\b/g
/** How many capitalised neighbours a known given name takes on each side (#416). */
const NAME_REACH = 3
const HONORIFIC_PATTERN = new RegExp(
  `\\b(?:${HONORIFICS.join('|')})\\.?\\s+([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,3})`,
  'g',
)
/**
 * Renders a literal so it matches case-insensitively **without** an `i` flag on
 * the enclosing pattern. The flag would also apply to the `[A-Z]` classes that
 * bound the name, letting a span run on into ordinary lowercase prose — which
 * is how the word "claim" once ended up tokenised as a patient name.
 */
function caseInsensitiveLiteral(literal: string): string {
  return literal
    .split('')
    .map((c) => {
      if (/[a-zA-Z]/.test(c)) return `[${c.toLowerCase()}${c.toUpperCase()}]`
      return /[.*+?^${}()|[\]\\/]/.test(c) ? `\\${c}` : c
    })
    .join('')
}

/** Case-flexible only on the particle; the name parts stay case-sensitive. */
const PARTICLE_ALTERNATION = PATRONYMICS.map(caseInsensitiveLiteral).join('|')

const PATRONYMIC_PATTERN = new RegExp(
  `\\b([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2})\\s+(?:${PARTICLE_ALTERNATION})\\.?\\s+([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,2})`,
  'g',
)

function isStopword(run: string): boolean {
  return run
    .split(/\s+/)
    .every((word) => NAME_STOPWORDS.has(word.toLowerCase().replace(/[^a-z]/g, '')))
}

const normalise = (word: string) => word.toLowerCase().replace(/[^a-z/]/g, '')

/**
 * Honorifics that may be dropped from the front of a name span.
 *
 * **A multi-word honorific is only ever dropped as a whole phrase.** Splitting
 * them on whitespace is how `Tan Sri` put `tan` and `sri` into the drop set
 * individually, and both are real Malaysian name elements: `Tan` is the
 * commonest Chinese Malaysian surname, and `Sri Devi a/p Ramasamy` trimmed to
 * `Devi`, sending `Sri` onward in cleartext. That is #149's failure mode
 * arriving through the other half of the same predicate.
 *
 * Single-word honorifics are additionally filtered against the gazetteer, as a
 * backstop for the same class of collision. A word that is both a title and a
 * name is ambiguous and the tie goes to treating it as a name: a false
 * honorific truncates a real name, while a missed one only leaves a title
 * inside a token.
 */
const HONORIFIC_WORDS = new Set(
  HONORIFICS.filter((h) => !h.includes(' '))
    .map((h) => h.toLowerCase())
    .filter((w) => !GIVEN_NAMES.has(w)),
)

const HONORIFIC_PHRASES = HONORIFICS.filter((h) => h.includes(' ')).map((h) =>
  h.toLowerCase().split(/\s+/),
)

/**
 * Narrows a candidate name span to the name itself.
 *
 * Token stability depends on this. `Encik Ahmad bin Ismail`, `Ahmad bin
 * Ismail` and `Tell Ahmad bin Ismail` are one person, and if the span keeps
 * whatever capitalised word happened to precede the name, they mint three
 * different tokens — the model then sees three patients where there is one,
 * and rehydration writes the stray word back into the note.
 *
 * **The gazetteer is deliberately not an anchor here, and used to be** (#149).
 * Jumping to the first word `GIVEN_NAMES` recognised is how `Zarul bin Ismail`
 * tokenised as `Ismail` and sent `Zarul` to the model in cleartext: the anchor
 * landed on the one element the gazetteer happened to know and discarded
 * everything before it on that basis alone. The gazetteer holds roughly 200
 * names, so being outside it is the ordinary case for a real patient, and
 * `assertNoIdentifiers` cannot catch the miss because the egress guard re-runs
 * these same detectors and shares the blind spot.
 *
 * What decides where a name starts is now only `NAME_STOPWORDS` and
 * `HONORIFIC_WORDS`. Every entry in either is a word that can no longer begin a
 * detected name, which makes both lists safety-critical rather than cosmetic.
 *
 * Keeping an unrecognised leading word leaves a stray word inside a token,
 * costing token stability. That is the trade this module already makes
 * deliberately: see the Malay weekday note in `gazetteer.ts`, which keeps
 * `Jumaat` and `Ahad` out of the stopword list for exactly this reason. A
 * recall loss on the PHI boundary outranks a precision gain.
 */
function trimNameSpan(value: string, start: number): { value: string; start: number } | null {
  // Offsets come from the words themselves. Rejoining them with single spaces
  // and searching for the result missed any span split by a line break or two
  // spaces, and the token then landed on the dropped words instead (#416).
  const spans = [...value.matchAll(/\S+/g)]
  const words = spans.map((span) => span[0])

  let lead = 0
  let tail = words.length

  // A multi-word honorific is dropped only as a whole phrase, never word by
  // word: `Tan Sri` split into `tan` and `sri` is two real name elements.
  for (const phrase of HONORIFIC_PHRASES) {
    if (phrase.every((word, i) => normalise(words[i] ?? '') === word)) {
      lead = phrase.length
      break
    }
  }

  while (
    lead < tail &&
    (NAME_STOPWORDS.has(normalise(words[lead] ?? '')) ||
      HONORIFIC_WORDS.has(normalise(words[lead] ?? '')))
  )
    lead++
  while (tail > lead && NAME_STOPWORDS.has(normalise(words[tail - 1] ?? ''))) tail--
  if (lead >= tail) return null

  const from = spans[lead]?.index ?? 0
  const last = spans[tail - 1]
  const to = (last?.index ?? 0) + (last?.[0].length ?? 0)
  return { value: value.slice(from, to), start: start + from }
}

function detectNames(text: string): Match[] {
  const out: Match[] = []

  // 1. Patronymic — the strongest Malaysian cue. Spans both sides of the
  //    particle, so `Ahmad bin Ismail` is one name rather than two fragments.
  for (const m of text.matchAll(PATRONYMIC_PATTERN)) {
    const trimmed = trimNameSpan(m[0], m.index)
    if (!trimmed) continue
    out.push({
      label: 'PATIENT',
      start: trimmed.start,
      end: trimmed.start + trimmed.value.length,
      value: trimmed.value,
      score: 0.95,
    })
  }

  // 2. Honorific — tokenise the name, never the title.
  for (const m of text.matchAll(HONORIFIC_PATTERN)) {
    const name = m[1]
    if (!name) continue
    const start = m.index + m[0].lastIndexOf(name)
    out.push({ label: 'PATIENT', start, end: start + name.length, value: name, score: 0.9 })
  }

  // 3. Introducer phrase — "my name is X", "nama saya X". The phrase is
  //    case-insensitive; the captured name is not. An `i` flag on the whole
  //    pattern would make `[A-Z]` match lowercase and tokenise ordinary words.
  for (const intro of NAME_INTRODUCERS) {
    const pattern = new RegExp(
      `${caseInsensitiveLiteral(intro)}\\s+([A-Z][A-Za-z'\\-]+(?:\\s+[A-Z][A-Za-z'\\-]+){0,3})`,
      'g',
    )
    for (const m of text.matchAll(pattern)) {
      const name = m[1]
      if (!name || isStopword(name)) continue
      const start = m.index + m[0].lastIndexOf(name)
      out.push({ label: 'PATIENT', start, end: start + name.length, value: name, score: 0.85 })
    }
  }

  // 4. Gazetteer recall pass — capitalised runs whose first token is a known
  //    Malaysian given name and which carry no cue. This is the only measure
  //    available without a model that raises recall on unmarked names.
  //    The run is trimmed the same way the patronymic span is. It always
  //    should have been, and #183 is what made the omission observable: an
  //    untrimmed run starts on the honorific, so `Tan Sri Ahmad bin Ismail`
  //    left `Tan Sri` uncovered by the winning span and the preserved prefix
  //    tokenised the title as a patient. Trimming first puts the run fully
  //    inside the winner, where it is dropped as before.
  //
  //    The gazetteer is asked after trimming, and of every word (#413). Asking
  //    the run's first word before trimming meant any capitalised word in front
  //    of a name, "Today Siti Aminah", sent the whole name in cleartext. A word
  //    in front that is not a stopword stays inside the token, as #149 rules: it
  //    may be a name element the gazetteer does not know.
  //
  //    The run is read whole and the span centred on the known name (#416).
  //    Cutting runs into fixed four-word pieces split a name wherever a piece
  //    happened to end, sending the half without a known name in cleartext.
  //    Three words a side is the least reach that covers any four-word name
  //    wherever it sits, and it is bounded because a span taking the whole run
  //    swallows a Title-Cased symptom header (#178). It still costs up to seven
  //    words of a header where the fixed pieces cost four.
  for (const m of text.matchAll(CAPITALISED_RUN)) {
    if (isStopword(m[0])) continue
    for (const segment of nameSegments(m[0], m.index)) {
      const trimmed = trimNameSpan(segment.value, segment.start)
      if (!trimmed) continue
      if (!trimmed.value.split(/\s+/).some(isGivenName)) continue
      out.push({
        label: 'PATIENT',
        start: trimmed.start,
        end: trimmed.start + trimmed.value.length,
        value: trimmed.value,
        score: 0.6,
      })
    }
  }

  return out.map(stripPossessive)
}

/** `Siti's` anchors as `Siti` does: the run takes the possessive into the word. */
const isGivenName = (word: string) => GIVEN_NAMES.has(word.toLowerCase().replace(/'s?$/, ''))

/**
 * The stretches of a capitalised run within `NAME_REACH` words of a known given
 * name, with overlapping stretches joined, so one person stays one span.
 */
function nameSegments(run: string, start: number): { value: string; start: number }[] {
  const words = [...run.matchAll(/\S+/g)]
  const covered = words.map(() => false)
  words.forEach((word, i) => {
    if (!isGivenName(word[0])) return
    const to = Math.min(words.length, i + NAME_REACH + 1)
    for (let j = Math.max(0, i - NAME_REACH); j < to; j++) covered[j] = true
  })
  const segments: { value: string; start: number }[] = []
  let i = 0
  while (i < words.length) {
    if (!covered[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < words.length && covered[j + 1]) j++
    const from = words[i]?.index ?? 0
    const last = words[j]
    const to = (last?.index ?? 0) + (last?.[0].length ?? 0)
    segments.push({ value: run.slice(from, to), start: start + from })
    i = j + 1
  }
  return segments
}

// ─── Names in Chinese and Tamil script (#418) ───────────────────────────────

const HAN = '\\p{Script=Han}'
const SURNAME = `(?:${HAN_COMPOUND_SURNAMES.join('|')}|[${HAN_SURNAMES}])`
/** A Chinese name opens on a listed surname: 陈美玲, 欧阳娜娜. */
const HAN_NAME = `${SURNAME}${HAN}{1,2}`
/** Where a clause ends: punctuation, a space, or the end of the text. */
const CLAUSE_END = '(?=[\\p{P}\\p{S}\\s]|$)'
const CUE_GAP = '[\\s:：「『"“]*'
// A pronoun, a question word or a completed action after "我叫" is "I told
// you", "what is your name" or "I called", not a name.
const NOT_A_NAME = '(?![你他她它我您們们什甚啥谁誰乜了咗過过])'
const TAMIL = '[\\u0B80-\\u0BFF]'
const TAMIL_WORD = `${TAMIL}+`
// An initial: one letter, as ஆர். or கே. or R., never a whole short word such
// as மணி, which a sentence-ending full stop would otherwise turn into one.
const INITIAL =
  '(?:(?:[\\u0B85-\\u0B94]?[\\u0B95-\\u0BB9]\\u0BCD|[\\u0B95-\\u0BB9][\\u0BBE-\\u0BCC]?|[A-Z])\\.\\s*)?'
/** One Tamil name word, with its initial. */
const TAMIL_ONE = `${INITIAL}${TAMIL_WORD}`
/** Up to two, after an explicit "my name is". */
const TAMIL_FULL = `${INITIAL}${TAMIL_WORD}(?:[ \\t]+${TAMIL_WORD})?`
// "என் பெயர் என்ன" is "what is my name", and "சொல்ல" opens "shall I say it".
const NOT_A_TAMIL_NAME = '(?!என்ன|சொல்ல)'
// Only the Latin introducers that say "name": "saya" or "I am" before Chinese
// or Tamil is ordinary code-switched speech ("saya 咳嗽三天"). Each is a whole
// word, so "symptoms" does not read as "Ms".
const LATIN_NAME_INTRODUCERS = NAME_INTRODUCERS.filter((intro) => /name|nama/.test(intro))
const latin = (cues: readonly string[]) => `\\b(?:${cues.map(caseInsensitiveLiteral).join('|')})`

/**
 * Each cue, and whether what it captures is an ordinary word if the guess is
 * wrong. A surname alone before a title is not carried to other mentions,
 * because one character also opens ordinary words.
 */
const NATIVE_NAME_PATTERNS: RegExp[] = [
  new RegExp(`(?:${HAN_NAME_INTRODUCERS.join('|')})${CUE_GAP}${NOT_A_NAME}(${HAN_NAME})`, 'gu'),
  // A given name with no surname, "我叫美玲", only where the clause then ends.
  new RegExp(
    `(?:${HAN_NAME_INTRODUCERS.join('|')})${CUE_GAP}${NOT_A_NAME}(${HAN}{2,3})${CLAUSE_END}`,
    'gu',
  ),
  new RegExp(
    `(?:${HAN_THIRD_PERSON_INTRODUCERS.join('|')})${CUE_GAP}(${HAN_NAME})${CLAUSE_END}`,
    'gu',
  ),
  // "我姓陈，叫美玲" gives the given name as a second capture.
  new RegExp(
    `(?:${HAN_SURNAME_INTRODUCERS.join('|')})${CUE_GAP}${NOT_A_NAME}(${SURNAME})(?:[，,、\\s]*(?:名叫|叫做|叫|名)(?![我你他她])(${HAN}{1,4})${CLAUSE_END})?`,
    'gu',
  ),
  // The surname alone, directly before a title, and only where it starts a
  // word: after punctuation, a space, or a verb that takes a person.
  new RegExp(
    `(?:(?<!${HAN})|(?<=[${HAN_BEFORE_SURNAME}]))(${SURNAME})[ \\t]?(?=${HAN_TITLES.join('|')})`,
    'gu',
  ),
  new RegExp(
    `(?:${TAMIL_NAME_INTRODUCERS.join('|')})[:：]?\\s+${NOT_A_TAMIL_NAME}(${TAMIL_FULL})`,
    'gu',
  ),
  new RegExp(`(?<!${TAMIL})(?:${TAMIL_TITLES.join('|')})(?:\\.\\s*|\\s+)(${TAMIL_ONE})`, 'gu'),
  new RegExp(`${latin(LATIN_NAME_INTRODUCERS)}\\s+(${HAN_NAME}|${TAMIL_FULL})${CLAUSE_END}`, 'gu'),
  new RegExp(
    `${latin(HONORIFICS)}\\.?\\s+(${SURNAME}(?:${HAN}{1,2})?|${TAMIL_ONE})${CLAUSE_END}`,
    'gu',
  ),
]

/**
 * A name said in Chinese or Tamil script, where a cue says one comes next.
 *
 * Neither script is read by `SCRIPT`, so the note can read Mandarin and Tamil
 * speech, and no Latin detector reads them either. A cue is the only footing
 * that does not tokenise ordinary speech: "我叫" or "என் பெயர்" before the
 * name, or a title such as 先生 or திரு beside it. A name said with no cue still
 * reaches the model, which `docs/decisions.md` D-011 records.
 *
 * Once a name has been found by its cue, its other mentions in the same text
 * are found too, so "我叫陈美玲。陈美玲今年三十岁" does not send the second one.
 * A one-character surname is not carried, because 陈 also opens 陈皮.
 */
function detectNativeScriptNames(text: string): Match[] {
  const cued: Match[] = []
  for (const pattern of NATIVE_NAME_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      let from = m.index + m[0].length
      for (const name of m.slice(1).reverse()) {
        if (!name) continue
        const start = m.index + m[0].lastIndexOf(name, from - m.index)
        from = start
        // 谢谢医生: a surname right after the same character is a doubled word.
        if (text[start - 1] === name[0]) continue
        cued.push({ label: 'PATIENT', start, end: start + name.length, value: name, score: 0.85 })
      }
    }
  }
  // Carried only from a capture that ends a clause, so a wrong guess cut from
  // the middle of a phrase is never spread across the transcript.
  const carried = new Set(
    cued
      .filter(
        (m) =>
          [...m.value].length >= 2 && new RegExp(`^${CLAUSE_END}`, 'u').test(text.slice(m.end)),
      )
      .map((m) => m.value),
  )
  const repeated: Match[] = []
  for (const value of carried) {
    const tamil = new RegExp(`^${TAMIL}`, 'u').test(value)
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + value.length)) {
      // A Tamil name is a whole word; மணி inside மணிக்கு is not the name.
      if (
        tamil &&
        new RegExp(`${TAMIL}`, 'u').test(`${text[at - 1] ?? ''}${text[at + value.length] ?? ''}`)
      ) {
        continue
      }
      repeated.push({ label: 'PATIENT', start: at, end: at + value.length, value, score: 0.85 })
    }
  }
  return [...cued, ...repeated]
}

/**
 * `Siti Nurhaliza` and `Siti Nurhaliza's` are one person (#167).
 *
 * The name patterns admit `'` inside a word so that `O'Brien` and `Nur'ain`
 * survive intact, which also lets a trailing possessive into the span. The
 * vault keys on the matched text, so the possessive form minted `[PATIENT_2]`
 * for somebody already carrying `[PATIENT_1]`, and the model was told there
 * were two people in the room.
 *
 * Nothing leaks, which is what makes this a quality fix rather than a boundary
 * one: both tokens rehydrate correctly. Applied to every name path rather than
 * inside `trimNameSpan`, because only the patronymic path goes through that
 * function and a possessive is just as likely after an honorific or an
 * introducer.
 */
function stripPossessive(match: Match): Match {
  const trimmed = match.value.replace(/['’]s?$/, '')
  if (trimmed === match.value || trimmed.length === 0) return match
  return { ...match, value: trimmed, end: match.start + trimmed.length }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

const DETECTORS = [
  detectNric,
  detectEmail,
  detectPhone,
  detectAddress,
  detectDob,
  detectMrn,
  detectNames,
  detectNativeScriptNames,
  detectScript,
] as const

/**
 * Overlapping matches are resolved longest-first, then by score. A shorter span
 * inside an accepted one is dropped, because replacing it would corrupt the
 * outer span's offsets and leave a fragment of the original identifier behind.
 *
 * **A shorter span that starts before the one it loses to keeps its uncovered
 * prefix** (#183). Dropping the loser whole discarded text that no accepted
 * span covered, and on the name path that text is a name element:
 *
 * ```
 * "Nur Aina Sofea Batrisyia binti Zulkifli came in."
 *   gazetteer run    [0,24)   "Nur Aina Sofea Batrisyia"
 *   patronymic span  [4,39)   "Aina Sofea Batrisyia binti Zulkifli"   longer, wins
 *   was              "Nur [PATIENT_1] came in."                       leaks
 * ```
 *
 * `assertNoIdentifiers` could not catch it, because the egress guard re-runs
 * these same detectors and shared the gap exactly.
 *
 * The prefix is kept as its own match rather than merged into the winner.
 * Merging would mean one token instead of two, which reads better, but it
 * extends an accepted span using a lower-scored loser's boundary and would join
 * spans of different labels, so an ADDRESS could annex a PATIENT. The cost is
 * that one person can mint two tokens where the prefix is a name element. That
 * is the trade this module states in `trimNameSpan`: a recall loss on the PHI
 * boundary outranks a precision gain.
 *
 * **The uncovered end is kept the same way** (#416). An honorific span losing
 * to a longer gazetteer span in `Nurse Siti Encik Zarul Damia Qaseh` kept
 * nothing past the winner, so `Qaseh` reached the model. Any stretch of the
 * loser outside every winner, at its start, between winners or at its end, now
 * stays a match of its own.
 *
 * Full containment is unchanged: nothing uncovered means the loser is
 * dropped, which is what keeps the docstring reason above true.
 */
function resolveOverlaps(matches: Match[]): Match[] {
  const sorted = [...matches].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || b.score - a.score || a.start - b.start,
  )
  const kept: Match[] = []
  for (const m of sorted) {
    const overlapping = kept.filter((k) => m.start < k.end && k.start < m.end)
    if (overlapping.length === 0) {
      kept.push(m)
      continue
    }

    let cursor = m.start
    for (const k of overlapping.sort((a, b) => a.start - b.start)) {
      if (k.start > cursor) kept.push(...uncovered(m, cursor, k.start))
      cursor = Math.max(cursor, k.end)
    }
    if (cursor < m.end) kept.push(...uncovered(m, cursor, m.end))
  }
  return kept.sort((a, b) => a.start - b.start)
}

function uncovered(m: Match, from: number, to: number): Match[] {
  const raw = m.value.slice(from - m.start, to - m.start)
  const value = raw.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '')
  if (value.length === 0) return []
  const start = from + raw.indexOf(value)
  return [{ ...m, value, start, end: start + value.length }]
}

export function detect(text: string): Match[] {
  const all = DETECTORS.flatMap((d) => d(text)).filter((m) => m.score >= ACCEPT_THRESHOLD)
  return resolveOverlaps(all)
}
