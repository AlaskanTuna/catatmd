import type { Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { proposeMishearCorrections } from './mishears.js'

/**
 * The doctor-facing half of the measured confusable table (#308).
 *
 * `mishears.test.ts` pins what the red-flag matcher does with this table, where
 * the expansion is never shown to anyone. These pin the opposite property: here
 * the doctor reads the result, so nothing may be expanded, reconstructed, or
 * applied without them.
 */

const transcript = (text: string, source: Transcript['source']): Transcript => ({
  source,
  turns: [{ speaker: 'patient', text }],
})

describe('proposeMishearCorrections', () => {
  it('offers the measured replacement for a devoiced word', () => {
    const [proposal, ...rest] = proposeMishearCorrections(
      transcript('Saya ada teman dua hari.', 'asr_hosted'),
    )

    expect(rest).toEqual([])
    expect(proposal).toEqual({
      turnIndex: 0,
      start: 9,
      original: 'teman',
      suggested: 'demam',
      // Measured, and named as such so the constrained model pass beside it
      // cannot be mistaken for it (#309).
      source: 'mishear',
    })
  })

  it('slices `original` from the turn rather than rebuilding it from the table', () => {
    // The table is keyed lowercase, so a rebuilt token would come back
    // lowercase and the doctor would be shown a word the record does not hold.
    const [proposal] = proposeMishearCorrections(transcript('Teman dua hari.', 'asr_live'))

    expect(proposal?.original).toBe('Teman')
    expect(proposal?.suggested).toBe('Demam')
  })

  it('leaves the transcript untouched', () => {
    const input = transcript('Saya ada teman dua hari.', 'asr_local')
    const before = structuredClone(input)

    proposeMishearCorrections(input)

    expect(input).toEqual(before)
  })

  it.each(['fixture', 'paste', 'upload'] as const)(
    'proposes nothing on a %s transcript, where no recogniser was involved',
    (source) => {
      // "teman" typed by a person is the everyday word for a companion.
      expect(proposeMishearCorrections(transcript('Pergi dengan teman.', source))).toEqual([])
    },
  )

  it.each(['asr_local', 'asr_hosted', 'asr_live'] as const)(
    'proposes on a %s transcript, because a mishear is possible there',
    (source) => {
      expect(proposeMishearCorrections(transcript('Ada teman.', source))).toHaveLength(1)
    },
  )

  it('locates a proposal in the turn it came from', () => {
    const proposals = proposeMishearCorrections({
      source: 'asr_live',
      turns: [
        { speaker: 'doctor', text: 'Ada apa hari ini?' },
        { speaker: 'patient', text: 'Saya patut sudah lima hari.' },
        { speaker: 'patient', text: 'Tekak saya pengkat.' },
      ],
    })

    expect(proposals.map((p) => [p.turnIndex, p.original, p.suggested])).toEqual([
      [1, 'patut', 'batuk'],
      [2, 'pengkat', 'bengkak'],
    ])
  })

  it('reports offsets that reconstruct the correction exactly', () => {
    const text = 'Saya patut dan ada teman juga.'
    const proposals = proposeMishearCorrections({
      source: 'asr_live',
      turns: [{ speaker: 'patient', text }],
    })

    // What Accept does on the client: splice each span back into the original.
    for (const p of proposals) {
      expect(text.slice(p.start, p.start + p.original.length)).toBe(p.original)
    }
    expect(proposals).toHaveLength(2)
  })

  it('never proposes inside a longer word', () => {
    // The table is whole-token only: "sepatutnya" contains "patut" and is a
    // different word entirely.
    expect(proposeMishearCorrections(transcript('Sepatutnya begitu.', 'asr_live'))).toEqual([])
  })

  it('proposes nothing when the transcript holds no measured confusable', () => {
    expect(
      proposeMishearCorrections(transcript('Saya batuk sudah lima hari.', 'asr_live')),
    ).toEqual([])
  })
})
