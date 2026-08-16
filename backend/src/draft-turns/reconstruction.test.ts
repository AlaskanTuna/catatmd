import { describe, expect, it } from 'vitest'
import { ReconstructionError, reconstructTurns } from './reconstruction.js'

/**
 * Pure tests for the verbatim guard (#189, docs/trd.md §20.5). No mocks: the
 * model's turns are accepted only as boundaries and speaker labels, and every
 * turn's shipped text is re-sliced from the input rather than taken from the
 * model, so these tests exercise `reconstructTurns` directly against
 * synthetic, non-clinical strings.
 */
describe('reconstructTurns', () => {
  it('accepts an exact split with no drift and re-slices each turn verbatim', () => {
    const input = 'hello world foo bar'

    const result = reconstructTurns(
      [
        { speaker: 'doctor', text: 'hello world' },
        { speaker: 'patient', text: 'foo bar' },
      ],
      input,
    )

    expect(result).toEqual([
      { speaker: 'doctor', text: 'hello world' },
      { speaker: 'patient', text: 'foo bar' },
    ])
  })

  it('accepts model casing drift and added punctuation, re-slicing lowercase text verbatim from the input', () => {
    const input = 'eh kenapa you datang hari ini oh i came here'

    const result = reconstructTurns(
      [
        { speaker: 'doctor', text: 'Eh kenapa you datang hari ini?' },
        { speaker: 'patient', text: 'Oh, I came here.' },
      ],
      input,
    )

    expect(result).toEqual([
      { speaker: 'doctor', text: 'eh kenapa you datang hari ini' },
      { speaker: 'patient', text: 'oh i came here' },
    ])
  })

  it('produces turns whose text is always an exact substring of the input', () => {
    const input = 'eh kenapa you datang hari ini oh i came here'

    const result = reconstructTurns(
      [
        { speaker: 'doctor', text: 'Eh kenapa you datang hari ini?' },
        { speaker: 'patient', text: 'Oh, I came here.' },
      ],
      input,
    )

    for (const turn of result) expect(input).toContain(turn.text)
  })

  it('rejects a paraphrase', () => {
    const input = 'hello world foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'greetings world' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects a dropped word', () => {
    const input = 'hello world foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'hello' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects an added word', () => {
    const input = 'hello world foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'hello world extra' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects reordered words', () => {
    const input = 'hello world foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'world hello' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects a translation', () => {
    const input = 'hello world foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'hai world' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects [PATIENT_1] mangled to [PATIENT 1]', () => {
    const input = 'Hello [PATIENT_1] please sit'

    expect(() =>
      reconstructTurns([{ speaker: 'doctor', text: 'Hello [PATIENT 1] please sit' }], input),
    ).toThrow(ReconstructionError)
  })

  it('rejects [PATIENT_1] split across two turns', () => {
    const input = 'Hello [PATIENT_1] please sit'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: 'Hello [PATIENT_1' },
          { speaker: 'patient', text: '] please sit' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('rejects a punctuation-only turn', () => {
    const input = 'foo bar'

    expect(() =>
      reconstructTurns(
        [
          { speaker: 'doctor', text: '...' },
          { speaker: 'patient', text: 'foo bar' },
        ],
        input,
      ),
    ).toThrow(ReconstructionError)
  })

  it('reconstructs the whole text from a single turn', () => {
    const input = 'one two three'

    const result = reconstructTurns([{ speaker: 'doctor', text: 'One Two Three.' }], input)

    expect(result).toEqual([{ speaker: 'doctor', text: 'one two three' }])
  })

  it('passes speakers through unchanged', () => {
    const input = 'hello world foo bar'

    const result = reconstructTurns(
      [
        { speaker: 'patient', text: 'hello world' },
        { speaker: 'doctor', text: 'foo bar' },
      ],
      input,
    )

    expect(result[0]?.speaker).toBe('patient')
    expect(result[1]?.speaker).toBe('doctor')
  })
})
