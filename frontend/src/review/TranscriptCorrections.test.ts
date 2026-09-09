import type { MishearProposal, Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { applyProposal } from './TranscriptCorrections.js'

/**
 * The splice an accepted proposal performs (#308).
 *
 * The component around it is a rendering concern; this is the part that touches
 * the clinical record, and the invariant it must not break is `labelsReviewed`.
 */
const transcript: Transcript = {
  source: 'asr_live',
  labelsReviewed: false,
  turns: [
    { speaker: 'doctor', text: 'Ada apa hari ini?' },
    { speaker: 'patient', text: 'Saya ada teman dua hari.', offsetSeconds: 4 },
  ],
}

const proposal: MishearProposal = {
  turnIndex: 1,
  start: 9,
  original: 'teman',
  suggested: 'demam',
  source: 'mishear',
}

describe('applyProposal', () => {
  it('replaces only the proposed span', () => {
    expect(applyProposal(transcript, proposal).turns[1]?.text).toBe('Saya ada demam dua hari.')
  })

  it('leaves every other turn untouched', () => {
    expect(applyProposal(transcript, proposal).turns[0]).toEqual(transcript.turns[0])
  })

  it('never flips labelsReviewed', () => {
    // It gates the red-flag engine's question-denial suppression. Accepting a
    // spelling is not confirming every speaker on every turn, and flipping it
    // here would weaken the engine on the strength of one corrected word.
    expect(applyProposal(transcript, proposal).labelsReviewed).toBe(false)
  })

  it('preserves the transcript source', () => {
    // `source` gates `isRecorded`, so losing it would stop further proposals.
    expect(applyProposal(transcript, proposal).source).toBe('asr_live')
  })

  it('preserves per-turn timing, so audio playback still lines up', () => {
    expect(applyProposal(transcript, proposal).turns[1]?.offsetSeconds).toBe(4)
  })

  it('does not mutate the transcript it was given', () => {
    const before = structuredClone(transcript)
    applyProposal(transcript, proposal)
    expect(transcript).toEqual(before)
  })

  it('handles a replacement longer than the original', () => {
    const longer: Transcript = {
      source: 'asr_live',
      turns: [{ speaker: 'patient', text: 'Tekak saya penkak.' }],
    }
    expect(
      applyProposal(longer, {
        turnIndex: 0,
        start: 11,
        original: 'penkak',
        suggested: 'bengkak',
        source: 'mishear',
      }).turns[0]?.text,
    ).toBe('Tekak saya bengkak.')
  })
})
