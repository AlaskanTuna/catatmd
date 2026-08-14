import { describe, expect, it } from 'vitest'
import { type DraftLine, draftToTurns, segmentsToDraft } from './draft-turns.js'
import type { TranscriptSegment } from './protocol.js'

/*
 * Cases mirror the measured spike recording (docs/trd.md §20.2): contiguous
 * segment partitions, question anchors, and the two documented failure modes,
 * asserted as the wrong answers they are so the limitation stays visible.
 */

const seg = (start: number, end: number | null, text: string): TranscriptSegment => ({
  start,
  end,
  text,
})

const fullText = (segments: TranscriptSegment[]) => segments.map((s) => s.text).join(' ')

describe('segmentsToDraft', () => {
  it('makes one line per segment with the segment start as its offset', () => {
    const segments = [
      seg(0, 4.1, ' Morning, what brings you in today?'),
      seg(4.1, 6.8, ' Doctor, I am Kamal.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft).toHaveLength(2)
    expect(draft[0]).toMatchObject({ speaker: 'doctor', offsetSeconds: 0 })
    expect(draft[1]).toMatchObject({ speaker: 'patient', offsetSeconds: 4.1 })
  })

  it('labels the opening line as the doctor and the line after a question as the patient', () => {
    const segments = [seg(0, 2, ' Any fever?'), seg(2, 5, ' Yesterday quite hot.')]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient'])
  })

  it('re-anchors on a question so a drifted alternation recovers', () => {
    const segments = [
      seg(0, 2, ' Throat is red.'),
      seg(2, 4, ' Tonsils a bit swollen.'),
      seg(4, 6, ' Any phlegm when you cough?'),
      seg(6, 8, ' A bit, whitish colour.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    // Line 2 is alternation (wrong on a doctor monologue, by design); line 3
    // is rule 3 pulling the question back to the doctor; line 4 is the answer.
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient', 'doctor', 'patient'])
  })

  it('keeps a questioning reply with the patient (rule 2 beats rule 3)', () => {
    const segments = [seg(0, 2, ' Any chest pain?'), seg(2, 4, ' Yes, since this morning?')]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft[1]?.speaker).toBe('patient')
  })

  it('hands a patient question to the doctor: the documented wrong case', () => {
    const segments = [
      seg(0, 2, ' Take the medicine after food.'),
      seg(2, 5, ' Doctor, my wife also got cough, should she come in?'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    // Wrong on purpose: rule 3 reads any question as the doctor asking. The
    // toggle list exists because of exactly this.
    expect(draft[1]?.speaker).toBe('doctor')
  })

  it('omits offsets when asked, for appended recordings whose timebase restarted', () => {
    const segments = [seg(0, 2, ' Morning.')]
    const draft = segmentsToDraft(segments, fullText(segments), { withOffsets: false })
    expect(draft[0]).not.toHaveProperty('offsetSeconds')
  })

  it('returns nothing for empty segments', () => {
    expect(segmentsToDraft([], '')).toEqual([])
  })

  it('returns nothing when starts are not monotonic', () => {
    const segments = [seg(5, 6, ' b'), seg(2, 3, ' a')]
    expect(segmentsToDraft(segments, fullText(segments))).toEqual([])
  })

  it('returns nothing when a timestamp is not finite', () => {
    const segments = [seg(Number.NaN, 2, ' a')]
    expect(segmentsToDraft(segments, 'a')).toEqual([])
  })

  it('returns nothing when the segments do not reconstruct the transcription', () => {
    const segments = [seg(0, 2, ' half of'), seg(2, 4, ' the story')]
    expect(segmentsToDraft(segments, 'a different transcription entirely')).toEqual([])
  })

  it('tolerates a null end on the final segment', () => {
    const segments = [seg(0, 2, ' Morning.'), seg(2, null, ' Morning doctor.')]
    expect(segmentsToDraft(segments, fullText(segments))).toHaveLength(2)
  })
})

describe('draftToTurns', () => {
  it('strips ids and keeps offsets only where present', () => {
    const draft: DraftLine[] = [
      { id: 'seg-0', speaker: 'doctor', text: 'Morning.', offsetSeconds: 0 },
      { id: 'seg-1', speaker: 'patient', text: 'Morning doctor.' },
    ]
    expect(draftToTurns(draft)).toEqual([
      { speaker: 'doctor', text: 'Morning.', offsetSeconds: 0 },
      { speaker: 'patient', text: 'Morning doctor.' },
    ])
  })
})
