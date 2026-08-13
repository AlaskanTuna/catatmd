import {
  GIVEN_NAMES,
  HONORIFICS,
  NAME_INTRODUCERS,
  NAME_STOPWORDS,
  PATRONYMICS,
} from './gazetteer.js'
import { isStructurallyValidNric, NRIC_PATTERN } from './nric.js'

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

export type DetectorLabel = 'PATIENT' | 'NRIC' | 'PHONE' | 'ADDRESS' | 'DOB' | 'MRN' | 'EMAIL'

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

function hasContext(text: string, start: number, end: number, words: readonly string[]): boolean {
  const window = text
    .slice(Math.max(0, start - CONTEXT_WINDOW), Math.min(text.length, end + CONTEXT_WINDOW))
    .toLowerCase()
  return words.some((w) => window.includes(w))
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

const NRIC_CONTEXT = ['ic', 'i/c', 'nric', 'mykad', 'kad pengenalan', 'identity', 'pesakit']

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
  return out
}

// ─── Phone ───────────────────────────────────────────────────────────────────

const PHONE_PATTERN =
  /(?:\+?60[\s-]?)?0?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b|\b0\d[\s-]?\d{3,4}[\s-]?\d{4}\b/g
const PHONE_CONTEXT = ['phone', 'call', 'contact', 'hp', 'handphone', 'mobile', 'telefon', 'number']

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

// ─── Address ─────────────────────────────────────────────────────────────────

/** A street-type keyword through to a 5-digit postcode, or the reverse. */
const ADDRESS_PATTERN =
  /\b(?:No\.?\s*\d+[A-Za-z]?,?\s*)?(?:Jalan|Jln|Lorong|Lrg|Taman|Tmn|Kampung|Kg|Persiaran|Lebuh)\s+[A-Za-z0-9\s./'-]{2,40}?(?:,\s*\d{5}\s*[A-Za-z\s]{2,25})?/gi
const ADDRESS_CONTEXT = ['address', 'alamat', 'live', 'stay', 'tinggal', 'duduk', 'postcode']

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
const DOB_CUE = /(?:born(?:\s+on)?|date\s+of\s+birth|d\.?o\.?b\.?|birthday|lahir)\b/gi
const DATE_NEAR_CUE =
  /\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi

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

const MRN_CUE =
  /\b(?:MRN|RN|record\s+(?:no|number)|registration\s+(?:no|number)|clinic\s+(?:no|number)|patient\s+(?:id|no|number)|file\s+(?:no|number))\b[:\s.#-]*([A-Z]{0,4}[-/]?\d{3,10}[A-Z]?)\b/gi

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

const CAPITALISED_RUN = /\b[A-Z][a-z'-]{1,}(?:\s+[A-Z][a-z'-]{1,}){0,3}\b/g
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

const HONORIFIC_WORDS = new Set(HONORIFICS.flatMap((h) => h.toLowerCase().split(/\s+/)))

/**
 * Narrows a candidate name span to the name itself.
 *
 * Token stability depends on this. `Encik Ahmad bin Ismail`, `Ahmad bin
 * Ismail` and `Tell Ahmad bin Ismail` are one person, and if the span keeps
 * whatever capitalised word happened to precede the name, they mint three
 * different tokens — the model then sees three patients where there is one,
 * and rehydration writes the stray word back into the note.
 *
 * The gazetteer is the strongest available anchor: where a known given name
 * appears, the name starts there. Otherwise fall back to dropping leading
 * honorifics and stopwords.
 */
function trimNameSpan(value: string, start: number): { value: string; start: number } | null {
  const words = value.split(/\s+/)

  const anchor = words.findIndex((w) => GIVEN_NAMES.has(normalise(w)))
  let lead = anchor > 0 ? anchor : 0
  let tail = words.length
  while (
    lead < tail &&
    (NAME_STOPWORDS.has(normalise(words[lead] ?? '')) ||
      HONORIFIC_WORDS.has(normalise(words[lead] ?? '')))
  )
    lead++
  while (tail > lead && NAME_STOPWORDS.has(normalise(words[tail - 1] ?? ''))) tail--
  if (lead >= tail) return null

  const trimmed = words.slice(lead, tail).join(' ')
  const offset = value.indexOf(trimmed)
  return { value: trimmed, start: start + (offset < 0 ? 0 : offset) }
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
  for (const m of text.matchAll(CAPITALISED_RUN)) {
    const run = m[0]
    if (isStopword(run)) continue
    const first = run.split(/\s+/)[0]?.toLowerCase()
    if (!first || !GIVEN_NAMES.has(first)) continue
    out.push({
      label: 'PATIENT',
      start: m.index,
      end: m.index + run.length,
      value: run,
      score: 0.6,
    })
  }

  return out
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
] as const

/**
 * Overlapping matches are resolved longest-first, then by score. A shorter span
 * inside an accepted one is dropped, because replacing it would corrupt the
 * outer span's offsets and leave a fragment of the original identifier behind.
 */
function resolveOverlaps(matches: Match[]): Match[] {
  const sorted = [...matches].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || b.score - a.score || a.start - b.start,
  )
  const kept: Match[] = []
  for (const m of sorted) {
    if (kept.some((k) => m.start < k.end && k.start < m.end)) continue
    kept.push(m)
  }
  return kept.sort((a, b) => a.start - b.start)
}

export function detect(text: string): Match[] {
  const all = DETECTORS.flatMap((d) => d(text)).filter((m) => m.score >= ACCEPT_THRESHOLD)
  return resolveOverlaps(all)
}
