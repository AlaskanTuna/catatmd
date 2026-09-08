import { describe, expect, it } from 'vitest'
import { parseTranscript, serialiseTurns } from './transcript.js'

/*
 * First tests for the single shared parser (issue #118). All four input paths
 * (fixture, paste, upload, record) funnel through it, so the first block pins
 * the behaviour the function had before it moved here; the rest cover the
 * optional inline timestamp and the serialiser that emits it.
 */

describe('parseTranscript', () => {
  it('turns a labelled line into a turn', () => {
    expect(parseTranscript('Doctor: Any fever?')).toEqual([
      { speaker: 'doctor', text: 'Any fever?' },
    ])
  })

  it('tolerates case and spacing around the colon', () => {
    expect(parseTranscript('  PATIENT  :  Batuk sudah 3 hari.')).toEqual([
      { speaker: 'patient', text: 'Batuk sudah 3 hari.' },
    ])
  })

  it('appends an unlabelled line to the turn above as a continuation', () => {
    const turns = parseTranscript('Patient: My cough started\nthree days ago.')
    expect(turns).toEqual([{ speaker: 'patient', text: 'My cough started three days ago.' }])
  })

  it('drops leading unlabelled lines', () => {
    expect(parseTranscript('some preamble\nDoctor: Morning.')).toEqual([
      { speaker: 'doctor', text: 'Morning.' },
    ])
  })

  it('ignores blank lines between turns', () => {
    const turns = parseTranscript('Doctor: Morning.\n\nPatient: Morning, doctor.')
    expect(turns).toHaveLength(2)
  })

  it('treats a bare "Doctor:" with no text as a continuation, not a turn', () => {
    const turns = parseTranscript('Patient: Sore throat.\nDoctor:')
    expect(turns).toEqual([{ speaker: 'patient', text: 'Sore throat. Doctor:' }])
  })

  it('returns no turns for prose without labels', () => {
    expect(parseTranscript('just a wall of prose with no labels')).toEqual([])
  })

  it('reads an inline timestamp into offsetSeconds', () => {
    expect(parseTranscript('Doctor [0:04]: Any fever?')).toEqual([
      { speaker: 'doctor', text: 'Any fever?', offsetSeconds: 4 },
    ])
    expect(parseTranscript('Patient [2:15]: Batuk sudah 3 hari.')).toEqual([
      { speaker: 'patient', text: 'Batuk sudah 3 hari.', offsetSeconds: 135 },
    ])
  })

  it('leaves offsetSeconds unset when no timestamp is present', () => {
    const [turn] = parseTranscript('Doctor: Any fever?')
    expect(turn).not.toHaveProperty('offsetSeconds')
  })

  it('treats a malformed timestamp as part of no turn rather than misreading it', () => {
    // Seconds must be two digits under 60; anything else fails the line match
    // and falls into the continuation rule, staying visible instead of parsing
    // into a wrong time.
    expect(parseTranscript('Doctor [0:4]: Any fever?')).toEqual([])
    expect(parseTranscript('Doctor [0:99]: Any fever?')).toEqual([])
  })
})

describe('serialiseTurns', () => {
  it('emits labels with timestamps when offsets exist, without when absent', () => {
    const text = serialiseTurns([
      { speaker: 'doctor', text: 'Morning.', offsetSeconds: 0 },
      { speaker: 'patient', text: 'Morning, doctor.', offsetSeconds: 75.4 },
      { speaker: 'doctor', text: 'Any fever?' },
    ])
    expect(text).toBe(
      'Doctor [0:00]: Morning.\nPatient [1:15]: Morning, doctor.\nDoctor: Any fever?',
    )
  })

  it('round-trips through parseTranscript with whole-second offsets', () => {
    const turns = [
      { speaker: 'doctor' as const, text: 'Morning, what brings you in today?', offsetSeconds: 0 },
      { speaker: 'patient' as const, text: 'Batuk sudah 3 hari lah.', offsetSeconds: 4 },
      { speaker: 'doctor' as const, text: 'Any fever?' },
    ]
    expect(parseTranscript(serialiseTurns(turns))).toEqual(turns)
  })

  it('floors fractional offsets so a re-parse never invents precision', () => {
    const [turn] = parseTranscript(
      serialiseTurns([{ speaker: 'patient', text: 'Hello.', offsetSeconds: 3.6 }]),
    )
    expect(turn?.offsetSeconds).toBe(3)
  })
})

/*
 * The end time has to survive the textarea, because the textarea is the only
 * editing surface and everything is re-parsed out of it before submission
 * (#293). A field that serialises but does not parse is a field that silently
 * never reaches the API.
 */
describe('turn end times', () => {
  it('round-trips a start and an end', () => {
    const turns = [
      { speaker: 'doctor' as const, text: 'Any fever?', offsetSeconds: 4, endSeconds: 9 },
    ]
    expect(parseTranscript(serialiseTurns(turns))).toEqual(turns)
  })

  it('parses a range line', () => {
    expect(parseTranscript('Doctor [0:04-0:09]: Any fever?')).toEqual([
      { speaker: 'doctor', text: 'Any fever?', offsetSeconds: 4, endSeconds: 9 },
    ])
  })

  it('still parses a start-only line, so older transcripts keep working', () => {
    expect(parseTranscript('Doctor [0:04]: Any fever?')).toEqual([
      { speaker: 'doctor', text: 'Any fever?', offsetSeconds: 4 },
    ])
  })

  it('writes no range when the turn has no end', () => {
    expect(serialiseTurns([{ speaker: 'doctor', text: 'Any fever?', offsetSeconds: 4 }])).toBe(
      'Doctor [0:04]: Any fever?',
    )
  })

  it('ceils the end so a whole-second stamp never clips the last word', () => {
    expect(
      serialiseTurns([
        { speaker: 'patient', text: 'Since yesterday.', offsetSeconds: 4.2, endSeconds: 9.1 },
      ]),
    ).toBe('Patient [0:04-0:10]: Since yesterday.')
  })

  it('drops an end that precedes its start rather than trusting a hand edit', () => {
    expect(parseTranscript('Doctor [0:30-0:10]: Any fever?')).toEqual([
      { speaker: 'doctor', text: 'Any fever?', offsetSeconds: 30 },
    ])
  })

  it('ignores an end with no start, which cannot be seeked to', () => {
    expect(parseTranscript('Doctor: Any fever? [0:04-0:09]')).toEqual([
      { speaker: 'doctor', text: 'Any fever? [0:04-0:09]' },
    ])
  })

  it('crosses the minute boundary in both halves', () => {
    expect(parseTranscript('Patient [1:05-2:00]: Sakit tekak.')).toEqual([
      { speaker: 'patient', text: 'Sakit tekak.', offsetSeconds: 65, endSeconds: 120 },
    ])
  })
})
