import type { ClinicalScore, Transcript } from '@shared/types'
import type { ProfileId } from '../clinical-profiles/types.js'
import {
  type ScoreItemDefinition,
  type ScoreMeasurement,
  type ScoreReading,
  SORE_THROAT_SCORE,
  SORE_THROAT_SCORE_VERSION,
  sourceRef,
} from './sore-throat-score.js'

/**
 * The suggestion reader (#221), deliberately narrower than the red-flag engine.
 *
 * The engine is tuned to over-fire, because a missed flag is the worse error.
 * Here the worse error is the opposite: a wrong answer offered on a score the
 * doctor may only glance at. So a sentence counts only when it plainly states
 * or directly denies the finding, about this patient, now. Anything less
 * offers nothing, and the evidence shown is the whole sentence so the doctor
 * can see what was read before using it.
 */

type Prefill = { optionId: string; evidence: string }

const QUESTION_OPENER =
  /^(?:any|do\s+you|did\s+you|have\s+you|has\s+(?:it|there)|is\s+there|are\s+there|ada\s+tak|adakah)\b/i
const SAFETY_NETTING =
  /\b(?:if|unless|in\s+case|come\s+back|return|watch\s+(?:out\s+)?for|should\s+(?:you|it|they)|kalau|jika|sekiranya|apabila)\b/i
const ANOTHER_PERSON =
  /\b(?:son|daughter|wife|husband|child(?:ren)?|kids?|baby|mother|mum|mom|father|dad|brother|sister|grand(?:mother|father|ma|pa)|family|friends?|colleagues?|housemates?|roommates?|everyone|everybody|people|office|he|she|they|his|her|their|anak|isteri|suami|emak|ibu|ayah|bapa|adik|abang|kakak|kawan|orang)\b/i
// Another time, or a symptom already over: either way, not this presentation now.
const ANOTHER_TIME =
  /\b(?:last\s+(?:week|month|year)|(?:weeks?|months?|years?)\s+ago|previously|earlier|used\s+to|history\s+of|in\s+the\s+past|dulu|lepas|went\s+away|hilang|dah\s+baik|initially|at\s+first|until|sebelum)\b/i
const NEGATOR =
  /\b(?:no|not|non|never|without|denies|denied|deny|absent|none|nil|negative|neg|tak|tidak|takde|tiada|bukan|gone|resolved|stopped|cleared)\b|n't\b|\bnon-|-ve\b|\(-\)/i
// Products named after a symptom, so "cough syrup" is not a cough.
const PRODUCT =
  /\b(?:cough|fever)\s+(?:syrup|medicine|mixture|drops|lozenges?|meds|tablets?)\b|\bubat\s+(?:batuk|demam)\b/gi
const AFFIRMING = /\b(?:yes|ada|a\s+lot|still|again|bad|worse|really|so\s+much)\b/i
// What may follow a denied finding and leave it a plain denial.
const DENIAL_TAIL =
  /^\s*(?:at\s+all|anymore|any\s+more|langsung|pun|lah|now|doctor|doktor|(?:on|in|over)\s+(?:the\s+)?(?:tonsils?|throat|neck))?\s*[.!]?\s*$/i
// A clause that turns a list after a denial back into a report.
const SCOPE_BREAK = /^\s*(?:but|tapi|however)\b/i
// A short answer opening the next turn marks the turn before it as a question,
// punctuated or not ("Got cough" / "No.").
const SHORT_ANSWER = /^\s*(?:no|nope|nah|yes|yeah|yup|ya|tak|takde|tiada|tidak|belum|ada)\b/i
// A number that is a threshold, advice or a guess, never a reading.
const NOT_A_READING =
  /\b(?:above|over|more\s+than|below|under|less\s+than|exceed\w*|at\s+least|up\s+to|reach\w*|goes|gets|hits|when|felt\s+like|around|about|approximately|roughly|did\s+not\s+check|didn'?t\s+check|not\s+checked)\b|[<>~]/i
// A unit or measure after the number that makes it something other than a temperature.
const OTHER_MEASURE = /^\s*(?:years?|yrs?|y\/o|hours?|hrs?|days?|minutes?|mins?|bpm|\/min|mmhg|%)/i
// Sites that are not the anterior neck, which the node criterion names.
const EXCLUDED = /\b(?:posterior|occipital|axillary|inguinal)\b/i
const FEVER_STATED = /\b(?:fever(?:ish)?|febrile|demam|panas\s+badan)\b/i

interface Sentence {
  text: string
  /** Clauses, each marked when it sits inside a list a denial opened. */
  clauses: { text: string; underDenial: boolean }[]
}

function clausesOf(text: string): Sentence['clauses'] {
  const clauses: Sentence['clauses'] = []
  let underDenial = false
  for (const part of text.replace(PRODUCT, ' ').split(/(?=\bbut\b|\btapi\b|\bhowever\b)|,/i)) {
    if (SCOPE_BREAK.test(part) || AFFIRMING.test(part)) underDenial = false
    clauses.push({ text: part, underDenial })
    if (NEGATOR.test(part)) underDenial = true
  }
  return clauses
}

/**
 * Sentences that can establish anything: not a question, not advice about
 * what to watch for, not about someone else, not about another time.
 */
function readableSentences(transcript: Transcript): Sentence[] {
  const sentences: Sentence[] = []
  for (const [index, turn] of transcript.turns.entries()) {
    const next = transcript.turns[index + 1]
    const answered =
      next !== undefined && next.speaker !== turn.speaker && SHORT_ANSWER.test(next.text)
    // Split after a full stop and a space, so "38.4" stays one number.
    const parts = turn.text.split(/(?<=[.?!;])\s+/)
    for (const [position, raw] of parts.entries()) {
      const text = raw.trim()
      if (text.length === 0) continue
      if (answered && position === parts.length - 1) continue
      if (text.endsWith('?') || QUESTION_OPENER.test(text)) continue
      if (SAFETY_NETTING.test(text) || ANOTHER_PERSON.test(text) || ANOTHER_TIME.test(text))
        continue
      sentences.push({ text, clauses: clausesOf(text) })
    }
  }
  return sentences
}

const allIn = (clause: string, patterns: readonly RegExp[]) =>
  patterns.every((pattern) => pattern.test(clause))

/**
 * A clause with every pattern of one entry, no negator anywhere in it, and not
 * inside a list a denial opened ("no fever, cough or cold").
 */
function states(sentence: Sentence, stated: ScoreReading['stated']): boolean {
  return sentence.clauses.some(
    (clause) =>
      !clause.underDenial &&
      !NEGATOR.test(clause.text) &&
      !EXCLUDED.test(clause.text) &&
      stated.some((patterns) => allIn(clause.text, patterns)),
  )
}

/** A clause whose denial governs the finding directly and ends the clause. */
function denies(sentence: Sentence, denied: ScoreReading['denied']): boolean {
  return sentence.clauses.some((clause) =>
    denied.some((pattern) => {
      const match = clause.text.match(pattern)
      if (match?.index === undefined) return false
      return DENIAL_TAIL.test(clause.text.slice(match.index + match[0].length))
    }),
  )
}

function read(sentences: Sentence[], reading: ScoreReading): Prefill | null {
  const stated = sentences.filter((sentence) => states(sentence, reading.stated))
  const denied = sentences.filter((sentence) => denies(sentence, reading.denied))
  // Said both ways is a conflict for the doctor, not a reading.
  if (stated.length > 0 && denied.length > 0) return null
  if (stated[0]) return { optionId: reading.whenStated, evidence: stated[0].text }
  if (denied[0]) return { optionId: reading.whenDenied, evidence: denied[0].text }
  return null
}

/** The highest plausible reading, but only a reading: never a cut-off, advice or a guess. */
function measure(sentences: Sentence[], measurement: ScoreMeasurement): Prefill | null {
  let best: { value: number; evidence: string } | null = null
  const [low, high] = measurement.range
  for (const sentence of sentences) {
    if (NOT_A_READING.test(sentence.text)) continue
    for (const match of sentence.text.matchAll(measurement.pattern)) {
      const after = sentence.text.slice((match.index ?? 0) + match[0].length)
      if (OTHER_MEASURE.test(after)) continue
      const value = Number(match[1])
      if (!Number.isFinite(value) || value < low || value > high) continue
      if (best === null || value > best.value) best = { value, evidence: sentence.text }
    }
  }
  if (best === null) return null
  if (best.value > measurement.above)
    return { optionId: measurement.whenAbove, evidence: best.evidence }
  // A low reading today beside a fever reported elsewhere is for the doctor to weigh.
  const feverStated = sentences.some((sentence) =>
    sentence.clauses.some(
      (clause) =>
        !clause.underDenial && !NEGATOR.test(clause.text) && FEVER_STATED.test(clause.text),
    ),
  )
  return feverStated ? null : { optionId: measurement.whenNotAbove, evidence: best.evidence }
}

function prefillItem(sentences: Sentence[], item: ScoreItemDefinition): Prefill | null {
  if (item.measurement) return measure(sentences, item.measurement)
  if (item.reading) return read(sentences, item.reading)
  return null
}

/**
 * The sore-throat score with a suggestion on every item the transcript
 * plainly established, and none on the rest. The doctor chooses every answer;
 * a suggestion is only offered (shared/src/index.ts). Pure: no I/O, no model,
 * no clock.
 */
export function prefillSoreThroatScore(transcript: Transcript): ClinicalScore {
  const sentences = readableSentences(transcript)
  const { score } = SORE_THROAT_SCORE
  return {
    id: score.id,
    name: score.name,
    version: SORE_THROAT_SCORE_VERSION.id,
    guidelineIds: [sourceRef(score)],
    items: score.items.map((item: ScoreItemDefinition) => ({
      id: item.id,
      label: item.label,
      options: item.options.map((option) => ({ ...option })),
      suggestion: prefillItem(sentences, item),
    })),
  }
}

/**
 * The scores to offer on this consultation: none unless its profile is one
 * the score belongs to and a sentence plainly reports a sore throat. A denied
 * one ("no sore throat"), a question, or someone else's offers nothing.
 */
export function scoresFor(transcript: Transcript, profileId: ProfileId): ClinicalScore[] {
  if (!SORE_THROAT_SCORE.profiles.includes(profileId)) return []
  const reported = readableSentences(transcript).some((sentence) =>
    sentence.clauses.some(
      (clause) =>
        !clause.underDenial &&
        SORE_THROAT_SCORE.presentation.some((patterns) =>
          patterns.every((pattern) => {
            const match = clause.text.match(pattern)
            // A negator after the complaint ("sore since monday no fever") is about something else.
            return match?.index !== undefined && !NEGATOR.test(clause.text.slice(0, match.index))
          }),
        ),
    ),
  )
  return reported ? [prefillSoreThroatScore(transcript)] : []
}
