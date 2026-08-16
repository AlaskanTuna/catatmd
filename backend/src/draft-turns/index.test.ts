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
   * A rejected chunk fails the whole pass, deliberately.
   *
   * Keeping the other chunks and giving the rejected one its neighbour's
   * speaker was the tempting alternative, and it fabricates attribution: up to
   * a chunk of patient speech presented as the doctor's, with nothing marking
   * it invented. Failing is safe because the client's fallback drafts labels on
   * the device and says on screen that they are guesses.
   */
  it('fails rather than inventing a speaker for a rejected chunk', async () => {
    const { text: content } = deidentify(longStream)
    let call = 0
    stubClient(async (request) => {
      const chunk = (request as unknown as { content: string }).content
      call += 1
      if (call === 2) return { turns: [{ speaker: 'patient', text: 'not the input' }] }
      return { turns: [{ speaker: 'doctor', text: chunk }] }
    })

    await expect(draftTurns(content)).rejects.toBeInstanceOf(DraftTurnsError)
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
