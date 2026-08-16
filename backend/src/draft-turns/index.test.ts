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
