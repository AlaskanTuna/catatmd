import type { RedFlag, Transcript } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { proposeMishearCorrections } from '../redflags/index.js'
import { applyEditPolicy, type CleanupEdit, protectedSpans } from './policy.js'

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

const flag = (evidence: string): RedFlag => ({
  id: 'test-trigger',
  label: 'A trigger fired',
  severity: 'urgent',
  evidence,
  source: 'rule',
  ruleId: 'test-trigger',
})

describe('applyEditPolicy', () => {
  it('accepts a well-formed edit inside an uncertain span, stamped as model', () => {
    const { proposals, dropped } = applyEditPolicy(edit('teman', 'demam'), transcript, [])

    expect(dropped).toBe(0)
    expect(proposals).toEqual([
      { turnIndex: 0, start: 5, original: 'teman', suggested: 'demam', source: 'model' },
    ])
  })

  it('drops a no-op', () => {
    expect(applyEditPolicy(edit('teman', 'teman'), transcript, [])).toEqual({
      proposals: [],
      dropped: 1,
    })
  })

  it('drops an oversized anchor, because a long one is a sentence rewrite', () => {
    const long = 'Saya teman dua hari dan sakit kepala juga'
    expect(applyEditPolicy(edit(long, 'demam'), transcript, []).proposals).toEqual([])
  })

  it('drops a replacement carrying anything but letters', () => {
    for (const bad of ['demam 3', 'demam!', '[PATIENT_1]', '38.5', '']) {
      expect(applyEditPolicy(edit('teman', bad), transcript, []).proposals).toEqual([])
    }
  })

  it('drops a replacement more than one word away from the original', () => {
    expect(applyEditPolicy(edit('teman', 'demam sudah lama'), transcript, []).proposals).toEqual([])
  })

  it('drops an anchor that occurs more than once, since the model gave no position', () => {
    const repeated: Transcript = {
      source: 'asr_live',
      turns: [{ speaker: 'patient', text: 'teman dan teman', uncertain: [{ start: 0, end: 5 }] }],
    }
    expect(applyEditPolicy(edit('teman', 'demam'), repeated, []).proposals).toEqual([])
  })

  it('drops an anchor that occurs nowhere at all', () => {
    expect(applyEditPolicy(edit('tiada', 'demam'), transcript, []).proposals).toEqual([])
  })

  it('drops an edit outside every uncertain span', () => {
    // "hari" is real text the recogniser was confident about. Correcting words
    // nothing doubted is the unconstrained rewriting arXiv 2407.21414 measured
    // as making a transcript worse.
    expect(applyEditPolicy(edit('hari', 'har'), transcript, []).proposals).toEqual([])
  })

  it('accepts nothing at all on a turn carrying no uncertainty', () => {
    const typed: Transcript = {
      source: 'paste',
      turns: [{ speaker: 'patient', text: 'Saya teman dua hari' }],
    }
    expect(applyEditPolicy(edit('teman', 'demam'), typed, []).proposals).toEqual([])
  })
})

describe('the red-flag overlap rule', () => {
  it('drops a model edit that overlaps the evidence of a fired rule flag', () => {
    // The single most important case in this feature. `evaluateRedFlags` runs
    // over whatever transcript is stored, so a doctor accepting this edit would
    // change the word the rule matched and the flag would stop firing.
    const { proposals, dropped } = applyEditPolicy(edit('teman', 'demam'), transcript, [
      flag('teman dua hari'),
    ])

    expect(proposals).toEqual([])
    expect(dropped).toBe(1)
  })

  it('leaves a model edit alone when the flag fired somewhere else', () => {
    const { proposals } = applyEditPolicy(edit('teman', 'demam'), transcript, [
      flag('Demam tu tinggi tak'),
    ])

    expect(proposals).toHaveLength(1)
  })

  it('does not stop the measured table proposing the same correction', () => {
    // The other half of the pair, and the reason `source` exists. A `mishear`
    // proposal never passes through this policy: it only moves the transcript
    // the way `expandMishears` already read it inside the engine, so the flag
    // it would touch fired *because* of that reading.
    const blocked = applyEditPolicy(edit('teman', 'demam'), transcript, [flag('teman dua hari')])
    const measured = proposeMishearCorrections(transcript)

    expect(blocked.proposals).toEqual([])
    expect(measured).toContainEqual(
      expect.objectContaining({ original: 'teman', suggested: 'demam', source: 'mishear' }),
    )
  })

  it("protects the whole transcript when a flag's evidence cannot be located", () => {
    // A RedFlag carries quoted text and no position, so evidence that appears in
    // no turn is a span this cannot reason about. Refusing every model edit is
    // the only answer that cannot be wrong in the dangerous direction.
    expect(protectedSpans(transcript, [flag('words nobody said')])).toBe('all')
    expect(
      applyEditPolicy(edit('teman', 'demam'), transcript, [flag('words nobody said')]),
    ).toEqual({ proposals: [], dropped: 1 })
  })

  it('records every occurrence when evidence appears more than once', () => {
    const twice: Transcript = {
      source: 'asr_live',
      turns: [{ speaker: 'patient', text: 'demam dan demam' }],
    }
    expect(protectedSpans(twice, [flag('demam')])).toEqual(
      new Map([
        [
          0,
          [
            [0, 5],
            [10, 15],
          ],
        ],
      ]),
    )
  })

  it('counts drops without reporting the words', () => {
    const edits: CleanupEdit[] = [
      { original: 'teman', replacement: 'teman' },
      { original: 'tiada', replacement: 'demam' },
      { original: 'teman', replacement: 'demam' },
    ]
    const result = applyEditPolicy(edits, transcript, [])

    expect(result.dropped).toBe(2)
    expect(result.proposals).toHaveLength(1)
  })
})
