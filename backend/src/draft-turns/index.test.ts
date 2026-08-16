import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeidentificationError, deidentify } from '../deid/index.js'
import { getLLMClient, LLMResponseError } from '../lib/llm/index.js'
import { DraftTurnsError, draftTurns } from './index.js'

vi.mock('../lib/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/index.js')>()
  return { ...actual, getLLMClient: vi.fn() }
})

interface StubRequest {
  operation: string
}

const stubClient = (generate: (request: StubRequest) => Promise<unknown>) => {
  const spy = vi.fn(generate)
  vi.mocked(getLLMClient).mockReturnValue({
    provider: 'qwen',
    model: 'test-model',
    generate: spy,
  } as never)
  return spy
}

beforeEach(() => {
  vi.mocked(getLLMClient).mockReset()
})

describe('draftTurns', () => {
  it('calls generate with the fixed operation shape and returns the re-sliced turns', async () => {
    const { text: content } = deidentify('doctor how are you feeling patient i have a cough')

    const spy = stubClient(async () => ({
      turns: [
        { speaker: 'doctor', text: 'Doctor, how are you feeling?' },
        { speaker: 'patient', text: 'Patient: I have a cough.' },
      ],
    }))

    const result = await draftTurns(content)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      operation: 'draft_turns',
      content,
      schemaName: 'draft_turns',
      temperature: 0,
      maxTokens: 16_384,
    })
    expect(result).toEqual([
      { speaker: 'doctor', text: 'doctor how are you feeling' },
      { speaker: 'patient', text: 'patient i have a cough' },
    ])
  })

  it('wraps a plain generate rejection as DraftTurnsError("llm_failed")', async () => {
    const { text: content } = deidentify('doctor how are you feeling')
    stubClient(async () => {
      throw new Error('provider offline')
    })

    await expect(draftTurns(content)).rejects.toMatchObject({
      name: 'DraftTurnsError',
      reason: 'llm_failed',
    })
  })

  it('wraps an LLMResponseError as DraftTurnsError("llm_failed")', async () => {
    const { text: content } = deidentify('doctor how are you feeling')
    stubClient(async () => {
      throw new LLMResponseError('schema validation failed', 'draft_turns')
    })

    await expect(draftTurns(content)).rejects.toBeInstanceOf(DraftTurnsError)
    await expect(draftTurns(content)).rejects.toMatchObject({ reason: 'llm_failed' })
  })

  it('passes a DeidentificationError from generate through unwrapped', async () => {
    const { text: content } = deidentify('doctor how are you feeling')
    stubClient(async () => {
      throw new DeidentificationError('egress blocked')
    })

    await expect(draftTurns(content)).rejects.toBeInstanceOf(DeidentificationError)
  })

  it('wraps a reconstruction failure as DraftTurnsError("not_reconstructed")', async () => {
    const { text: content } = deidentify('doctor how are you feeling')
    stubClient(async () => ({
      turns: [{ speaker: 'doctor', text: 'This is a paraphrase entirely.' }],
    }))

    await expect(draftTurns(content)).rejects.toMatchObject({
      name: 'DraftTurnsError',
      reason: 'not_reconstructed',
    })
  })
})

/*
 * Chunking (#189 follow-up).
 *
 * The pass is a verbatim echo guarded by word-for-word reconstruction, so one
 * drifted word discarded every label in the call. Measured against production,
 * 653 characters labelled cleanly and 1,335 returned `draft_failed`, while a
 * real consultation is several thousand: the pass failed on the input it
 * exists for.
 */
describe('draftTurns over a consultation-length transcript', () => {
  /** Long enough to cross several chunk boundaries, in the unpunctuated
   * lowercase shape the hosted relay actually returns (docs/trd.md 20.3). */
  const longStream = (() => {
    const unit =
      'doctor good morning what brings you in today patient i have had a cough for four days and my throat hurts when i swallow '
    let text = ''
    while (text.length < 2_400) text += unit
    return text.trim()
  })()

  it('splits the work rather than sending one oversized call', async () => {
    const { text: content } = deidentify(longStream)
    const spy = stubClient(async (request) => {
      const chunk = (request as unknown as { content: string }).content
      return { turns: [{ speaker: 'doctor', text: chunk }] }
    })

    await draftTurns(content)

    expect(spy.mock.calls.length).toBeGreaterThan(1)
    for (const call of spy.mock.calls) {
      const chunk = (call[0] as unknown as { content: string }).content
      expect(chunk.length).toBeLessThanOrEqual(600)
    }
  })

  it('keeps every word of the transcript across the boundaries', async () => {
    const { text: content } = deidentify(longStream)
    stubClient(async (request) => {
      const chunk = (request as unknown as { content: string }).content
      return { turns: [{ speaker: 'doctor', text: chunk }] }
    })

    const turns = await draftTurns(content)
    const words = (text: string) => text.split(/\s+/).filter(Boolean)
    expect(words(turns.map((turn) => turn.text).join(' '))).toEqual(words(content))
  })

  /*
   * A rejected chunk costs its own labels and nothing else.
   *
   * Failing the whole pass was the previous behaviour and it did not hold up:
   * measured in production, a 2,543-character transcript still returned
   * `draft_failed` at ~28 s, because all five chunks had to land. The opposite,
   * giving the rejected chunk its neighbour's speaker, fabricates attribution.
   * The marker is what makes the third option honest.
   */
  it('keeps the labels the other chunks earned, and marks the one that failed', async () => {
    const { text: content } = deidentify(longStream)
    let call = 0
    stubClient(async (request) => {
      const chunk = (request as unknown as { content: string }).content
      call += 1
      // A dropped word, which is exactly what reconstruction refuses.
      if (call === 2) return { turns: [{ speaker: 'patient', text: 'not the input' }] }
      return { turns: [{ speaker: 'doctor', text: chunk }] }
    })

    const turns = await draftTurns(content)

    expect(turns.some((turn) => turn.undrafted === true)).toBe(true)
    expect(turns.some((turn) => turn.undrafted === undefined)).toBe(true)
    const words = (text: string) => text.split(/\s+/).filter(Boolean)
    expect(words(turns.map((turn) => turn.text).join(' '))).toEqual(words(content))
  })

  it('never folds an unlabelled span into a labelled neighbour', async () => {
    const { text: content } = deidentify(longStream)
    let call = 0
    stubClient(async (request) => {
      const chunk = (request as unknown as { content: string }).content
      call += 1
      if (call === 2) return { turns: [{ speaker: 'patient', text: 'not the input' }] }
      return { turns: [{ speaker: 'doctor', text: chunk }] }
    })

    const turns = await draftTurns(content)

    // Every neighbouring pair differs in speaker or in drafted state, so an
    // unlabelled span is never hidden inside a labelled turn.
    for (const [index, turn] of turns.entries()) {
      const next = turns[index + 1]
      if (next === undefined) continue
      expect(
        turn.speaker !== next.speaker || Boolean(turn.undrafted) !== Boolean(next.undrafted),
      ).toBe(true)
    }
  })

  it('discards an undrafted flag the model tries to set', async () => {
    const { text: content } = deidentify('doctor good morning patient i have a cough')
    stubClient(async (request) => ({
      turns: [
        {
          speaker: 'doctor',
          text: (request as unknown as { content: string }).content,
          undrafted: true,
        },
      ],
    }))

    const turns = await draftTurns(content)

    expect(turns.every((turn) => turn.undrafted === undefined)).toBe(true)
  })

  it('never opens more than four provider calls at once', async () => {
    const { text: content } = deidentify(longStream)
    let live = 0
    let peak = 0
    stubClient(async (request) => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((resolve) => setTimeout(resolve, 5))
      live -= 1
      return {
        turns: [{ speaker: 'doctor', text: (request as unknown as { content: string }).content }],
      }
    })

    await draftTurns(content)

    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('still fails when no chunk survives, so a broken pass is never a draft', async () => {
    const { text: content } = deidentify(longStream)
    stubClient(async () => ({ turns: [{ speaker: 'doctor', text: 'not the input at all' }] }))

    await expect(draftTurns(content)).rejects.toBeInstanceOf(DraftTurnsError)
  })

  it('reports a provider outage as llm_failed rather than a reconstruction mismatch', async () => {
    const { text: content } = deidentify(longStream)
    stubClient(async () => {
      throw new LLMResponseError('provider is down', 'draft_turns')
    })

    await expect(draftTurns(content)).rejects.toMatchObject({ reason: 'llm_failed' })
  })

  it('leaves a short transcript as exactly one call', async () => {
    const { text: content } = deidentify('doctor good morning patient i have a cough')
    const spy = stubClient(async (request) => ({
      turns: [{ speaker: 'doctor', text: (request as unknown as { content: string }).content }],
    }))

    await draftTurns(content)

    expect(spy).toHaveBeenCalledTimes(1)
  })
})
