import {
  type DraftTurn,
  type InterpretedLanguage,
  MAX_TURN_CHARACTERS,
  type TextRange,
  type TranscriptTurn,
} from '@shared/types'
import type { MarkedSegment } from '../draft-turns.js'
import type { TranscriptSegment } from '../protocol.js'
import { joinTokens, type LiveSegment, type LiveToken, uncertainRanges } from './live-tokens.js'

/*
 * What a translated stream becomes: each utterance in the words it was spoken
 * in, paired with its machine translation (#393). Pure and DOM-free like
 * `live-tokens.ts` beside it, and the only module that reads a translated
 * token as anything other than something to drop.
 *
 * **The pairing is measured, not assumed.** #389 streamed synthetic dialogues
 * and found, in about 3,600 final tokens, every translation run arriving
 * directly after the original chunk it translates, and `<end>` never arriving
 * before it (docs/trd.md §20.12). So a translation joins the utterance that is
 * open when it arrives. That is not a nicety: `findDeniedAbility` composes an
 * emergency flag from turn adjacency alone, and a translated "No." on the
 * wrong turn would silently drop it.
 */

/** The names a doctor reads on chips, pickers and placeholders. */
export const INTERPRETED_LANGUAGE_NAMES: Record<InterpretedLanguage, string> = {
  bn: 'Bengali',
  ur: 'Urdu',
  zh: 'Mandarin',
  ta: 'Tamil',
}

export type OtherLanguage = NonNullable<TranscriptTurn['otherLanguage']>

/**
 * Scripts no de-identification detector reads: Bengali, Arabic (which Urdu is
 * written in) with its supplements and presentation forms, Devanagari, which a
 * recogniser may use if it hears Urdu as Hindi, and Chinese and Tamil with the
 * CJK and fullwidth punctuation Chinese is written with.
 *
 * Chinese and Tamil are here although the gate's `SCRIPT` detector leaves
 * them alone on purpose (docs/trd.md §20.12): that detector also guards the
 * untranslated Auto-detect path, where both are read natively. This module
 * runs on translated sessions only, where the English is the text and the
 * original belongs in `otherLanguage`, so neither may reach `turn.text`.
 */
const UNREADABLE_SCRIPT =
  /[ঀ-৿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿ऀ-ॿ\p{Script=Han}\p{Script=Tamil}\u3000-\u303F\uFF00-\uFFEF]+/gu

/**
 * The English of a patient turn whose translation never arrived.
 *
 * A fixed string rather than an empty turn, because an empty turn serialises as
 * `Patient: `, which the parser folds into the turn above it, and rather than
 * the original, because that is script the engine cannot match and the gate
 * cannot de-identify. The review banner counts turns carrying it.
 */
export const untranslatedTurnText = (language: InterpretedLanguage): string =>
  `[Untranslated ${INTERPRETED_LANGUAGE_NAMES[language]} speech]`

export type BilingualTurn = {
  /** The words as spoken. */
  spoken: string
  /** What the recogniser tagged the words as, weighted by duration. */
  language: string | null
  /** The machine translation, as much of it as has arrived. */
  translation: string
  translationLanguage: string | null
  /** Seconds from the start, from the spoken tokens. */
  start: number
  end: number
  /** Where the recogniser doubted the spoken words. English speech only. */
  uncertain?: readonly TextRange[]
  /** Closed by `<end>` or a change of language, so it will not grow again. */
  closed: boolean
}

type Building = {
  spoken: LiveToken[]
  translation: LiveToken[]
  closed: boolean
}

/** The language a set of spoken tokens was mostly in, by duration. */
function dominantLanguage(tokens: readonly LiveToken[]): string | null {
  const held = new Map<string, number>()
  for (const token of tokens) {
    if (token.language === null) continue
    const ms = Math.max(1, token.endMs - token.startMs)
    held.set(token.language, (held.get(token.language) ?? 0) + ms)
  }
  let dominant: string | null = null
  let longest = 0
  for (const [language, ms] of held) {
    if (ms > longest) {
      longest = ms
      dominant = language
    }
  }
  return dominant
}

/**
 * Settled tokens to utterances, each with its translation.
 *
 * An utterance closes on `<end>`, or when speech arrives in a different
 * language, which is how a reply that followed with no pause still becomes its
 * own turn. The recogniser tags a code-switched chunk as one language, so
 * "আমার chest pain আছে" stays one Bengali utterance rather than three.
 *
 * A translation that finds no open utterance in its source language, which
 * #389 never saw happen, joins the **oldest** utterance in that language still
 * waiting for one, never the latest: a late "No." belongs to the question
 * that was asked before the next one.
 */
export function tokensToBilingualTurns(tokens: readonly LiveToken[]): BilingualTurn[] {
  const built: Building[] = []
  let open: Building | null = null

  for (const token of tokens) {
    if (token.endpoint) {
      if (open) open.closed = true
      open = null
      continue
    }

    if (token.translated === true) {
      const source = token.sourceLanguage ?? null
      const openLanguage = open ? dominantLanguage(open.spoken) : null
      const target =
        open && (source === null || openLanguage === null || openLanguage === source)
          ? open
          : (built.find(
              (turn) =>
                turn.spoken.length > 0 &&
                turn.translation.length === 0 &&
                dominantLanguage(turn.spoken) === source,
            ) ?? null)
      if (target) {
        target.translation.push(token)
      } else {
        built.push({ spoken: [], translation: [token], closed: true })
      }
      continue
    }

    if (open && token.language !== null) {
      const current = dominantLanguage(open.spoken)
      if (current !== null && current !== token.language) {
        open.closed = true
        open = null
      }
    }
    if (!open) {
      open = { spoken: [], translation: [], closed: false }
      built.push(open)
    }
    open.spoken.push(token)
  }

  let previousEnd = 0
  const turns: BilingualTurn[] = []
  for (const turn of built) {
    const { text, spans } = joinTokens(turn.spoken)
    const first = turn.spoken[0]
    const last = turn.spoken[turn.spoken.length - 1]
    const start = first ? first.startMs / 1_000 : previousEnd
    const end = last ? last.endMs / 1_000 : previousEnd
    previousEnd = end
    const language = dominantLanguage(turn.spoken)
    const uncertain = language === 'en' ? uncertainRanges(turn.spoken, spans) : undefined
    turns.push({
      spoken: text,
      language,
      translation: joinTokens(turn.translation).text,
      translationLanguage: turn.translation[0]?.language ?? null,
      start,
      end,
      ...(uncertain === undefined ? {} : { uncertain }),
      closed: turn.closed,
    })
  }
  return turns
}

/** The language the unsettled tail is in, for the pane to place it. */
export function interimLanguage(interim: readonly LiveToken[]): string | null {
  return dominantLanguage(interim.filter((token) => !token.endpoint && token.translated !== true))
}

/** Replaces script no detector reads with a marker, and tidies whitespace. */
const readable = (text: string): string =>
  text.replace(UNREADABLE_SCRIPT, '[untranslated]').replace(/\s+/g, ' ').trim()

const bounded = (text: string): string => text.slice(0, MAX_TURN_CHARACTERS)

type Line = {
  role: 'doctor' | 'patient'
  english: string
  other: OtherLanguage | null
  start: number
  end: number
  uncertain?: readonly TextRange[]
  untranslated: boolean
}

/**
 * One utterance as the transcript stores it.
 *
 * **The English is always the text.** English speech keeps its own words and
 * carries the translation the patient was shown; speech in the paired language
 * is carried by its translation and keeps the original. Anything else, Malay
 * above all, which the recogniser leaves untranslated and the engine reads
 * natively, stays as spoken once no unreadable script is left in it.
 *
 * **The role comes from the language, and it is a draft.** English is the
 * doctor; anything else is the patient, which is the direction the engine
 * fails safe in, since only a doctor label can earn a safety-netting
 * suppression. `labelsReviewed` stays false on this path as on every recorded
 * one. `null` for an orphan translation into the paired language: its English
 * was never heard, so it adds nothing a turn could carry.
 */
function toLine(turn: BilingualTurn, pair: InterpretedLanguage): Line | null {
  const translated = readable(turn.translation)

  if (turn.spoken === '') {
    if (turn.translationLanguage !== 'en' || translated === '') return null
    return {
      role: 'patient',
      english: translated,
      other: null,
      start: turn.start,
      end: turn.end,
      untranslated: false,
    }
  }

  if (turn.language === 'en') {
    const english = readable(turn.spoken)
    // The ranges index the spoken string, so they only travel when the guard
    // left that string exactly as it was.
    const uncertain = english === turn.spoken ? turn.uncertain : undefined
    return {
      role: 'doctor',
      english,
      other:
        turn.translation.trim() === ''
          ? null
          : { language: pair, text: bounded(turn.translation), spoken: false },
      start: turn.start,
      end: turn.end,
      ...(uncertain === undefined ? {} : { uncertain }),
      untranslated: false,
    }
  }

  const spokenReadable = readable(turn.spoken)
  const heardInPair = turn.language === pair || spokenReadable !== turn.spoken.trim()
  if (!heardInPair) {
    return {
      role: 'patient',
      english: spokenReadable,
      other: null,
      start: turn.start,
      end: turn.end,
      untranslated: false,
    }
  }

  return {
    role: 'patient',
    english: translated === '' ? untranslatedTurnText(pair) : translated,
    other: { language: pair, text: bounded(turn.spoken), spoken: true },
    start: turn.start,
    end: turn.end,
    untranslated: translated === '',
  }
}

/** Every line, split where one would exceed the per-turn bound. */
function toLines(turns: readonly BilingualTurn[], pair: InterpretedLanguage): Line[] {
  const lines: Line[] = []
  for (const turn of turns) {
    const line = toLine(turn, pair)
    if (line === null || line.english === '') continue
    if (line.english.length <= MAX_TURN_CHARACTERS) {
      lines.push(line)
      continue
    }
    /*
     * Split rather than cut: a turn past the schema's bound would fail the whole
     * save, and truncating it would drop clinical words without a trace. The
     * other half rides on the first piece only, and the uncertainty ranges on
     * none, because they index the unsplit string.
     */
    const { uncertain: _ranges, ...whole } = line
    for (let from = 0; from < line.english.length; from += MAX_TURN_CHARACTERS) {
      const english = line.english.slice(from, from + MAX_TURN_CHARACTERS).trim()
      if (english === '') continue
      lines.push(from === 0 ? { ...whole, english } : { ...whole, english, other: null })
    }
  }
  return lines
}

/** What the live panes read: English only, in order, with the drafted role. */
export type RoledSegment = TranscriptSegment & { role: 'doctor' | 'patient' }

/**
 * The live panes' view of a translated consultation.
 *
 * English only, so no script the gate cannot read reaches the live analysis
 * model. Every utterance but the last is closed, and a closed one has its
 * whole translation by #389's lockstep, so the panes' own rule of holding the
 * last segment back is exactly the rule a translation needs.
 */
export function bilingualLiveSegments(
  turns: readonly BilingualTurn[],
  pair: InterpretedLanguage,
): RoledSegment[] {
  return toLines(turns, pair).map((line) => ({
    text: line.english,
    start: line.start,
    end: line.end,
    role: line.role,
  }))
}

/** What the live pane shows: each utterance as spoken, with its translation. */
export function bilingualDisplay(turns: readonly BilingualTurn[]): LiveSegment[] {
  return turns
    .filter((turn) => turn.spoken !== '' || turn.translation !== '')
    .map((turn) => ({
      text: turn.spoken,
      start: turn.start,
      end: turn.end,
      speaker: turn.language,
      language: turn.language,
      translation: turn.translation,
      translationLanguage: turn.translationLanguage,
      ...(turn.uncertain === undefined ? {} : { uncertain: turn.uncertain }),
    }))
}

/**
 * The finished consultation, in the shapes the capture panel already applies.
 *
 * `draftTurns` stand where the labelling pass's turns would, one per segment
 * with the same text, so the timing and uncertainty carried from segments to
 * turns land one to one. `others` lines up with them index for index.
 */
export function bilingualDelivery(
  turns: readonly BilingualTurn[],
  pair: InterpretedLanguage,
): {
  text: string
  segments: MarkedSegment[]
  draftTurns: DraftTurn[]
  others: (OtherLanguage | null)[]
  untranslated: number
} {
  const lines = toLines(turns, pair)
  const segments: MarkedSegment[] = lines.map((line) => ({
    text: line.english,
    start: line.start,
    end: line.end,
    ...(line.uncertain === undefined ? {} : { uncertain: line.uncertain }),
  }))
  return {
    text: segments.map((segment) => segment.text).join(' '),
    segments,
    draftTurns: lines.map((line) => ({ speaker: line.role, text: line.english })),
    others: lines.map((line) => line.other),
    untranslated: lines.filter((line) => line.untranslated).length,
  }
}
