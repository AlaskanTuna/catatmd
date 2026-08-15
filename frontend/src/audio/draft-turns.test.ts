import { describe, expect, it } from 'vitest'
import { type DraftLine, draftToTurns, segmentsToDraft } from './draft-turns.js'
import type { TranscriptSegment } from './protocol.js'

/*
 * Cases mirror the measured failure modes of the segment-level v1 rules
 * (docs/trd.md §20.2): the within-segment speaker handoff, alternation
 * flipping on same-speaker continuations, and a patient's own question being
 * handed to the doctor, which is the red-flag-suppression shape from
 * backend/src/redflags/mislabel-suppression.test.ts.
 */

const seg = (start: number, end: number | null, text: string): TranscriptSegment => ({
  start,
  end,
  text,
})

const fullText = (segments: TranscriptSegment[]) => segments.map((s) => s.text).join(' ')

describe('segmentsToDraft', () => {
  it('makes one line per single-sentence segment with the segment start as its offset', () => {
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

  it('splits a segment holding both speakers at its sentence boundaries', () => {
    // The observed production failure: Whisper folded a doctor greeting, the
    // patient's symptom, and the doctor's follow-up into one segment, and the
    // v1 per-segment labels could not see the handoff at all.
    const segments = [
      seg(0, 13, ' Hi, how are you today? I have serious coughing for the past two days.'),
      seg(13, 18, " I didn't eat anything. I ate roti canai a lot."),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => [l.speaker, l.text])).toEqual([
      ['doctor', 'Hi, how are you today?'],
      ['patient', 'I have serious coughing for the past two days.'],
      ['patient', "I didn't eat anything. I ate roti canai a lot."],
    ])
  })

  it('carries the segment start only on the line that opens the segment', () => {
    const segments = [
      seg(0, 13, ' Hi, how are you today? I have serious coughing for the past two days.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft).toHaveLength(2)
    expect(draft[0]?.offsetSeconds).toBe(0)
    // A split line's true offset inside the segment is unknown; asserting one
    // would place a fabricated time in the evidence trace.
    expect(draft[1]).not.toHaveProperty('offsetSeconds')
  })

  it('merges consecutive same-speaker sentences within a segment back into one line', () => {
    const segments = [
      seg(0, 3, ' Wow, what did you just eat?'),
      seg(3, 8, " I didn't eat anything. I ate roti canai a lot."),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft).toHaveLength(2)
    expect(draft[1]).toMatchObject({
      speaker: 'patient',
      text: "I didn't eat anything. I ate roti canai a lot.",
      offsetSeconds: 3,
    })
  })

  it('keeps a doctor monologue with the doctor instead of alternating away from it', () => {
    const segments = [
      seg(0, 2, ' Throat is red.'),
      seg(2, 4, ' Tonsils a bit swollen.'),
      seg(4, 6, ' Any phlegm when you cough?'),
      seg(6, 8, ' A bit, whitish colour.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    // Line 2 continues the previous speaker: v1 alternation labelled it the
    // patient, its largest measured failure mode on the reference recording.
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'doctor', 'doctor', 'patient'])
  })

  it('keeps a questioning reply with the patient (answer outranks its own question mark)', () => {
    const segments = [seg(0, 2, ' Any chest pain?'), seg(2, 4, ' Yes, since this morning?')]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft[1]?.speaker).toBe('patient')
  })

  it('keeps a patient question about their own symptom with the patient', () => {
    // v1 handed any question to the doctor, which is exactly the shape that
    // can suppress a red flag: "Is it bad that I am coughing up blood?"
    // relabelled as a doctor question goes silent in the rules engine.
    const segments = [
      seg(0, 2, ' Take the medicine after food.'),
      seg(2, 5, ' Is it bad that I am coughing up blood?'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient'])
  })

  it('keeps a patient question addressed to the doctor with the patient', () => {
    const segments = [
      seg(0, 2, ' Take the medicine after food.'),
      seg(2, 5, ' Doctor, my wife also got cough, should she come in?'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft[1]?.speaker).toBe('patient')
  })

  it('keeps a patient asking about their own care with the patient, and does not cascade', () => {
    // Measured 15/08/26: without a first-person signal these fell to the
    // doctor as content-free questions, and the answer-after-question rule
    // then flipped the doctor's actual reply to the patient.
    const segments = [
      seg(0, 4, ' Your lungs sound clear.'),
      seg(4, 7, ' Do I need antibiotics?'),
      seg(7, 12, ' Not for this one. It looks viral.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient', 'doctor'])
  })

  it('reads "anything I should watch out for" as the patient', () => {
    const segments = [
      seg(0, 4, ' Take the medicine after food.'),
      seg(4, 8, ' Okay doctor, anything I should watch out for?'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient'])
  })

  it('does not read "if I am not around" as a patient symptom statement', () => {
    // The first-person symptom pattern must not fire on a bare negation:
    // measured 15/08/26 handing a doctor's closing advice to the patient.
    const segments = [
      seg(0, 4, ' Come back and see me.'),
      seg(4, 9, " You can see Dr. Tan if I'm not around."),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'doctor'])
  })

  it('does not split on decimals or titles', () => {
    const segments = [
      seg(0, 2, ' Any fever?'),
      seg(2, 6, ' Fever was 38.5 last night.'),
      seg(6, 10, ' You should see Dr. Tan when he is back. Anyway, my throat still hurts.'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    expect(draft.map((l) => l.text)).toEqual([
      'Any fever?',
      'Fever was 38.5 last night.',
      'You should see Dr. Tan when he is back.',
      'Anyway, my throat still hurts.',
    ])
    expect(draft.map((l) => l.speaker)).toEqual(['doctor', 'patient', 'doctor', 'patient'])
  })

  it('gives split lines ids that stay unique alongside segment ids', () => {
    const segments = [
      seg(0, 13, ' Hi, how are you today? I have serious coughing for the past two days.'),
      seg(13, 18, ' Any fever?'),
    ]
    const draft = segmentsToDraft(segments, fullText(segments))
    const ids = draft.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
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
      { id: 'seg-0-1', speaker: 'patient', text: 'Morning doctor.' },
    ]
    expect(draftToTurns(draft)).toEqual([
      { speaker: 'doctor', text: 'Morning.', offsetSeconds: 0 },
      { speaker: 'patient', text: 'Morning doctor.' },
    ])
  })
})
