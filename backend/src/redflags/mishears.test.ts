import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { evaluateRedFlags } from './evaluate.js'
import { expandMishears } from './mishears.js'
import { ALL_REDFLAG_TRIGGERS } from './triggers.js'

/**
 * The coverage that used to live in the review-time mishear hints (#193), now
 * applied server-side because the review surface it lived on was removed.
 *
 * `triggers.ts` deliberately does not widen for these pairs: bare `/\bdemam\b/`
 * with "teman" folded in would fire on every mention of a companion. That
 * refusal is still right for a typed transcript and wrong for a recorded one,
 * which is the whole distinction these tests pin.
 */

// Both profiles: `uti-systemic-features` is a UTI trigger, and it is the one
// whose only coverage for a devoiced "demam" was the deleted hint layer.
const ALL = ALL_REDFLAG_TRIGGERS

const transcript = (text: string, source: Transcript['source']): Transcript => ({
  source,
  turns: [{ speaker: 'patient', text }],
})

const ruleIds = (t: Transcript): string[] =>
  evaluateRedFlags(t, ALL)
    .map((f) => f.ruleId)
    .filter((id): id is string => id !== undefined)

const spans = (t: Transcript): string[] => evaluateRedFlags(t, ALL).map((f) => f.evidence)

describe('measured Malay devoicings on a recorded transcript', () => {
  it('raises the fever trigger that "teman" for "demam" was hiding', () => {
    // The blocker: `uti-systemic-features` is urgent, fires on bare /\bdemam\b/
    // and on nothing else a devoiced "demam" produces.
    expect(
      ruleIds(transcript('Saya ada teman dua hari dan sakit belakang.', 'asr_hosted')),
    ).toContain('uti-systemic-features')
  })

  it('leaves a typed transcript alone, where "teman" is a companion', () => {
    expect(ruleIds(transcript('Saya pergi dengan teman saya.', 'paste'))).toEqual([])
  })

  it('accepts the over-fire it buys on a recording', () => {
    // Stated rather than hidden: the same expansion that recovers the urgent
    // trigger also fires on the everyday word. One dismissal against one missed
    // escalation is the trade this engine is required to make.
    expect(ruleIds(transcript('Saya pergi dengan teman saya.', 'asr_hosted'))).toContain(
      'uti-systemic-features',
    )
  })

  it('quotes what the transcript says, never the expansion', () => {
    // A doctor reading the evidence trace has to be able to see why it fired.
    // "demam dua hari" is not a sentence in this record.
    const found = spans(transcript('Ada teman sejak semalam.', 'asr_hosted'))
    expect(found.join(' ')).toContain('teman')
    expect(found.join(' ')).not.toContain('demam')
  })
})

describe('expandMishears', () => {
  it('returns null when nothing was misheard', () => {
    expect(expandMishears('Sakit tekak sejak semalam.')).toBeNull()
  })

  it('leaves a longer word inside which the token sits untouched', () => {
    // Whole tokens only: "sepatutnya" is ordinary Malay, not a mishear of batuk.
    expect(expandMishears('Sepatutnya dia datang awal.')).toBeNull()
  })

  it('maps offsets back through a replacement that changes length', () => {
    // "penkak" to "bengkak" is 6 characters becoming 7, so the naive assumption
    // that offsets survive expansion is false for exactly this pair.
    const expanded = expandMishears('Ada penkak di kaki.')
    expect(expanded?.text).toBe('Ada bengkak di kaki.')
    const at = expanded?.text.indexOf('bengkak') ?? -1
    expect(expanded?.origin[at]).toBe('Ada penkak di kaki.'.indexOf('penkak'))
  })

  it('keeps the capital on a word that opened the sentence', () => {
    expect(expandMishears('Teman sudah tiga hari.')?.text).toBe('Demam sudah tiga hari.')
  })
})
