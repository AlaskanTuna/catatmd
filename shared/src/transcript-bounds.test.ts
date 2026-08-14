import { describe, expect, it } from 'vitest'
import { MAX_TRANSCRIPT_TURNS, MAX_TURN_CHARACTERS, TranscriptSchema } from './index.js'

/**
 * The bound exists to cap what reaches the de-identifier and the model, not to
 * cap what fits in a request. Pinning it here rather than in a route test keeps
 * it true for every caller of the shared contract, including the ephemeral
 * demo path that takes a transcript straight from the body.
 */
const turn = (text: string) => ({ speaker: 'patient' as const, text })
const transcript = (turns: { speaker: 'patient'; text: string }[]) => ({
  source: 'paste' as const,
  turns,
})

describe('transcript bounds', () => {
  it('accepts a transcript far longer than any real consultation', () => {
    // ~120 turns was the longest measured in development; this is well past it
    // and must still pass, because the bound is a runaway guard rather than a
    // product limit.
    const long = transcript(Array.from({ length: 300 }, () => turn('Still coughing at night.')))

    expect(TranscriptSchema.safeParse(long).success).toBe(true)
  })

  it('rejects more turns than the cap', () => {
    const tooMany = transcript(
      Array.from({ length: MAX_TRANSCRIPT_TURNS + 1 }, () => turn('cough')),
    )

    expect(TranscriptSchema.safeParse(tooMany).success).toBe(false)
  })

  it('rejects a single turn longer than the cap', () => {
    // The other half of the bound. Without it, one turn of 900,000 characters
    // passes a turn-count check and costs exactly as much to process.
    const huge = transcript([turn('a'.repeat(MAX_TURN_CHARACTERS + 1))])

    expect(TranscriptSchema.safeParse(huge).success).toBe(false)
  })

  it('still rejects an empty transcript and an empty turn', () => {
    expect(TranscriptSchema.safeParse(transcript([])).success).toBe(false)
    expect(TranscriptSchema.safeParse(transcript([turn('')])).success).toBe(false)
  })
})
