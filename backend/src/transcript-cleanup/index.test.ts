import type { Transcript } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeidentificationError } from '../deid/index.js'
import { getLLMClient } from '../lib/llm/index.js'
import { proposeModelCorrections } from './index.js'

vi.mock('../lib/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/index.js')>()
  return { ...actual, getLLMClient: vi.fn() }
})

interface StubRequest {
  operation: string
  content: string
  system: string
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

const uncertain: Transcript = {
  source: 'asr_live',
  turns: [{ speaker: 'patient', text: 'Saya teman dua hari', uncertain: [{ start: 5, end: 10 }] }],
}

beforeEach(() => {
  vi.mocked(getLLMClient).mockReset()
})

describe('proposeModelCorrections', () => {
  it('calls the provider with the fixed operation and returns located proposals', async () => {
    const spy = stubClient(async () => ({ edits: [{ original: 'teman', replacement: 'demam' }] }))

    const outcome = await proposeModelCorrections(uncertain, [])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ operation: 'transcript_cleanup' })
    expect(outcome).toEqual({
      status: 'ok',
      dropped: 0,
      proposals: [
        { turnIndex: 0, start: 5, original: 'teman', suggested: 'demam', source: 'model' },
      ],
    })
  })

  it('never reaches a provider when no turn carries uncertainty', async () => {
    // The gate is checked before de-identification, so a consultation with
    // nothing to correct does not leave the API at all. Every typed, pasted and
    // relayed transcript takes this branch.
    const spy = stubClient(async () => ({ edits: [] }))
    const typed: Transcript = {
      source: 'paste',
      turns: [{ speaker: 'patient', text: 'Saya teman dua hari' }],
    }

    const outcome = await proposeModelCorrections(typed, [])

    expect(spy).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'ok', proposals: [], dropped: 0 })
  })

  it('sends de-identified text, never the transcript as stored', async () => {
    const spy = stubClient(async () => ({ edits: [] }))
    const named: Transcript = {
      source: 'asr_live',
      turns: [
        {
          speaker: 'patient',
          text: 'Ahmad bin Ismail teman dua hari',
          uncertain: [{ start: 17, end: 22 }],
        },
      ],
    }

    await proposeModelCorrections(named, [])

    const sent = String(spy.mock.calls[0]?.[0].content)
    expect(sent).not.toContain('Ahmad bin Ismail')
    expect(sent).toContain('[PATIENT_1]')
  })

  it('reports failed rather than throwing when the provider does', async () => {
    // Layer 2 shipped unconditionally in #308 and must stay on the doctor's
    // screen when layer 3 falls over, which is why the route can answer 200
    // with a non-empty array and `cleanup: 'failed'`.
    stubClient(async () => {
      throw new Error('provider exploded')
    })

    const outcome = await proposeModelCorrections(uncertain, [])

    expect(outcome).toEqual({ status: 'failed', proposals: [], dropped: 0 })
  })

  it('lets a DeidentificationError through untouched', async () => {
    // The egress guard firing is an alarm, not a correction outcome, and must
    // never be softened into one.
    stubClient(async () => {
      throw new DeidentificationError('Egress blocked for operation "transcript_cleanup": NRIC')
    })

    await expect(proposeModelCorrections(uncertain, [])).rejects.toBeInstanceOf(
      DeidentificationError,
    )
  })

  it('drops a model edit the policy refuses and still reports ok', async () => {
    stubClient(async () => ({ edits: [{ original: 'hari', replacement: 'har' }] }))

    const outcome = await proposeModelCorrections(uncertain, [])

    expect(outcome).toEqual({ status: 'ok', proposals: [], dropped: 1 })
  })
})
