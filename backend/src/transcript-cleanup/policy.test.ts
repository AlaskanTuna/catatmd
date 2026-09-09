import { applyMishearProposal, type Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  ALL_REDFLAG_TRIGGERS,
  evaluateRedFlags,
  proposeMishearCorrections,
} from '../redflags/index.js'
import { applyEditPolicy, type CleanupEdit } from './policy.js'

/*
 * One case per drop rule, because the policy is the entire safety surface of
 * this feature and an untested rule is a rule that is not there. Nothing here
 * touches a provider: the model's contribution is two strings, so every rule can
 * be exercised by handing them over directly.
 */

/** "Saya teman dua hari", with "teman" (5 to 10) marked uncertain. */
const transcript: Transcript = {
  source: 'asr_live',
  turns: [
    { speaker: 'patient', text: 'Saya teman dua hari', uncertain: [{ start: 5, end: 10 }] },
    { speaker: 'doctor', text: 'Demam tu tinggi tak' },
  ],
}

const edit = (original: string, replacement: string): CleanupEdit[] => [{ original, replacement }]

const ruleIds = (t: Transcript) =>
  evaluateRedFlags(t, ALL_REDFLAG_TRIGGERS).map((flag) => flag.ruleId ?? flag.id)

describe('applyEditPolicy', () => {
  it('accepts a well-formed edit inside an uncertain span, stamped as model', () => {
    const { proposals, dropped } = applyEditPolicy(edit('teman', 'demam'), transcript)

    expect(dropped).toBe(0)
    expect(proposals).toEqual([
      { turnIndex: 0, start: 5, original: 'teman', suggested: 'demam', source: 'model' },
    ])
  })

  it('drops a no-op', () => {
    expect(applyEditPolicy(edit('teman', 'teman'), transcript)).toEqual({
      proposals: [],
      dropped: 1,
    })
  })

  it('drops an oversized anchor, because a long one is a sentence rewrite', () => {
    const long = 'Saya teman dua hari dan sakit kepala juga'
    expect(applyEditPolicy(edit(long, 'demam'), transcript).proposals).toEqual([])
  })

  it('drops a replacement carrying anything but letters', () => {
    for (const bad of ['demam 3', 'demam!', '[PATIENT_1]', '38.5', '']) {
      expect(applyEditPolicy(edit('teman', bad), transcript).proposals).toEqual([])
    }
  })

  it('drops a replacement more than one word away from the original', () => {
    expect(applyEditPolicy(edit('teman', 'demam sudah lama'), transcript).proposals).toEqual([])
  })

  it('drops an anchor that occurs more than once, since the model gave no position', () => {
    const repeated: Transcript = {
      source: 'asr_live',
      turns: [{ speaker: 'patient', text: 'teman dan teman', uncertain: [{ start: 0, end: 5 }] }],
    }
    expect(applyEditPolicy(edit('teman', 'demam'), repeated).proposals).toEqual([])
  })

  it('drops an anchor that occurs nowhere at all', () => {
    expect(applyEditPolicy(edit('tiada', 'demam'), transcript).proposals).toEqual([])
  })

  it('drops an edit outside every uncertain span', () => {
    // "hari" is real text the recogniser was confident about. Correcting words
    // nothing doubted is the unconstrained rewriting arXiv 2407.21414 measured
    // as making a transcript worse.
    expect(applyEditPolicy(edit('hari', 'har'), transcript).proposals).toEqual([])
  })

  it('accepts nothing at all on a turn carrying no uncertainty', () => {
    const typed: Transcript = {
      source: 'paste',
      turns: [{ speaker: 'patient', text: 'Saya teman dua hari' }],
    }
    expect(applyEditPolicy(edit('teman', 'demam'), typed).proposals).toEqual([])
  })

  it('counts drops without reporting the words', () => {
    const edits: CleanupEdit[] = [
      { original: 'teman', replacement: 'teman' },
      { original: 'tiada', replacement: 'demam' },
      { original: 'teman', replacement: 'demam' },
    ]
    const result = applyEditPolicy(edits, transcript)

    expect(result.dropped).toBe(2)
    expect(result.proposals).toHaveLength(1)
  })
})

describe('the suppression check, which is differential rather than positional', () => {
  /** "Ada batuk berdarah" raises `haemoptysis`, with "Ada" marked uncertain. */
  const haemoptysis: Transcript = {
    source: 'asr_live',
    turns: [{ speaker: 'patient', text: 'Ada batuk berdarah', uncertain: [{ start: 0, end: 3 }] }],
  }

  it('fires the flag this section depends on', () => {
    expect(ruleIds(haemoptysis)).toContain('haemoptysis')
  })

  it('refuses a negation flip that never touches the flag evidence', () => {
    /*
     * The case that killed the positional design. "Ada" to "Tiada" is one word,
     * letters only, zero word delta, sits inside an uncertain range, and does
     * not overlap "batuk berdarah" at all, so every span-based bound admits it.
     * `isNegated` reads sixty characters *before* the match, so on re-analysis
     * the emergency flag is gone.
     */
    const { proposals, dropped } = applyEditPolicy(edit('Ada', 'Tiada'), haemoptysis)

    expect(proposals).toEqual([])
    expect(dropped).toBe(1)

    // And the reason, stated as the property rather than taken on trust.
    const flipped = applyMishearProposal(haemoptysis, {
      turnIndex: 0,
      start: 0,
      original: 'Ada',
      suggested: 'Tiada',
      source: 'model',
    })
    expect(ruleIds(flipped)).not.toContain('haemoptysis')
  })

  it('refuses an edit to the flag evidence itself', () => {
    const onEvidence: Transcript = {
      source: 'asr_live',
      turns: [
        { speaker: 'patient', text: 'Ada batuk berdarah', uncertain: [{ start: 4, end: 9 }] },
      ],
    }
    expect(applyEditPolicy(edit('batuk', 'bapak'), onEvidence).proposals).toEqual([])
  })

  it('allows an edit that changes nothing the engine reads', () => {
    // A transcript raising no flag at all cannot lose one, so the check is a
    // no-op and the ordinary bounds decide.
    expect(applyEditPolicy(edit('teman', 'demam'), transcript).proposals).toHaveLength(1)
  })
})

describe('the measured table is never gated by this policy', () => {
  it('keeps proposing a correction the model would be refused for', () => {
    // The reason `source` exists. A `mishear` proposal never passes through
    // `applyEditPolicy`: the engine already expands the table internally, so a
    // flag matched on a table pair fired *because* of the corrected reading.
    const measured = proposeMishearCorrections(transcript)
    expect(measured).toContainEqual(
      expect.objectContaining({ original: 'teman', suggested: 'demam', source: 'mishear' }),
    )
  })

  it('never loses a rule hit when any measured proposal is accepted', () => {
    /*
     * The property the `mishear` exemption rests on, pinned rather than argued.
     * `findSpan` scans both the raw text and `expandMishears` of it, and no
     * table value is also a table key, so accepting a measured correction can
     * only move the raw text toward the expansion the engine already read. That
     * holds only while every devoiced pattern has a target-form twin; adding one
     * without the other would turn every measured proposal into a suppression
     * path, and this test is what would catch it.
     */
    const samples: Transcript[] = [
      { source: 'asr_live', turns: [{ speaker: 'patient', text: 'Ada patut berdarah' }] },
      { source: 'asr_live', turns: [{ speaker: 'patient', text: 'Saya sempuk teruk' }] },
      { source: 'asr_live', turns: [{ speaker: 'patient', text: 'Saya teman dua hari' }] },
      { source: 'asr_live', turns: [{ speaker: 'patient', text: 'Tekak saya pengkat' }] },
      { source: 'asr_live', turns: [{ speaker: 'patient', text: 'Ada tenggi dan kekak' }] },
    ]

    for (const sample of samples) {
      const before = ruleIds(sample)
      for (const proposal of proposeMishearCorrections(sample)) {
        const after = ruleIds(applyMishearProposal(sample, proposal))
        for (const id of before) {
          expect(after, `${proposal.original} to ${proposal.suggested} lost ${id}`).toContain(id)
        }
      }
    }
  })
})
