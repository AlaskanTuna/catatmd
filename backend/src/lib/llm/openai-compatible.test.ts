import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DeidentificationError, deidentify } from '../../deid/index.js'
import type { Deidentified } from '../../deid/types.js'

/**
 * GitHub issue #81. The egress guard at the top of `generate()` had no direct
 * coverage: it was exercised only incidentally through `acceptance/safety.test.ts`
 * and `deid/deid.test.ts`, neither of which can show that the request never
 * left the process.
 *
 * That is the property worth testing. `assertNoIdentifiers` throwing is not the
 * same claim as the provider never being called, and only the second one is the
 * PHI boundary.
 */

const { completionsCreate, envMock } = vi.hoisted(() => ({
  completionsCreate: vi.fn(),
  envMock: { DEID_FAIL_CLOSED: true },
}))

/**
 * Standing in for the SDK is what lets this assert on egress rather than on the
 * exception. If `completionsCreate` is never called, nothing reached the
 * network, which no amount of asserting on the thrown error can establish.
 */
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: completionsCreate } }
  },
}))

vi.mock('../../config/env.js', () => ({ env: envMock }))

const { OpenAICompatibleClient } = await import('./openai-compatible.js')

const Schema = z.object({ ok: z.boolean() })

function client() {
  return new OpenAICompatibleClient('qwen', 'qwen3.7-flash', {
    apiKey: 'test-key',
    baseURL: 'https://example.invalid/v1',
  })
}

function request(content: Deidentified) {
  return {
    operation: 'test_operation',
    system: 'system prompt',
    content,
    schema: Schema,
    schemaName: 'test_schema',
  }
}

/**
 * The provenance gap this guard exists to close, reproduced deliberately.
 *
 * `markDeidentified` is module-private, so the only way to brand a string that
 * still carries identifiers is the cast that `deid/types.ts` warns about.
 * Writing it here is the point: the cast is the attack being simulated, not an
 * endorsement of it, and a reviewer finding this pattern anywhere outside a
 * test should treat it as the review-blocking defect the rules call it.
 */
const SMUGGLED = 'Patient NRIC is 850523-14-5677' as unknown as Deidentified

beforeEach(() => {
  completionsCreate.mockReset()
  envMock.DEID_FAIL_CLOSED = true
})

describe('the adapter re-scans every payload before it leaves the process', () => {
  it('throws DeidentificationError when a branded value still carries identifiers', async () => {
    await expect(client().generate(request(SMUGGLED))).rejects.toBeInstanceOf(DeidentificationError)
  })

  it('never reaches the provider when the guard fires', async () => {
    await expect(client().generate(request(SMUGGLED))).rejects.toThrow()

    expect(
      completionsCreate,
      'The guard threw but the request still went out. Anything that calls the ' +
        'SDK before assertNoIdentifiers defeats the PHI boundary.',
    ).not.toHaveBeenCalled()
  })

  it('names detector labels in the error and never the matched values', async () => {
    const error = await client()
      .generate(request(SMUGGLED))
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DeidentificationError)
    expect((error as Error).message).toContain('NRIC')
    expect(
      (error as Error).message,
      'An exception message is a log line waiting to happen. It carries labels only.',
    ).not.toContain('850523-14-5677')
  })

  it('sends payloads that came through the gate', async () => {
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    })

    const { text } = deidentify('Patient NRIC is 850523-14-5677')

    await expect(client().generate(request(text))).resolves.toEqual({ ok: true })
    expect(completionsCreate).toHaveBeenCalledTimes(1)

    const sent = completionsCreate.mock.calls[0]?.[0] as { messages: { content: string }[] }
    expect(sent.messages[1]?.content).not.toContain('850523-14-5677')
  })
})

/**
 * `DEID_FAIL_CLOSED=false` is for unit tests only, and production throws at boot
 * if it is unset or false (`config/env.ts`). Pinning the behaviour here makes
 * the toggle documented rather than incidental, so a future reader can see what
 * the flag actually costs.
 */
describe('DEID_FAIL_CLOSED=false skips the guard, which is why production forbids it', () => {
  it('sends a payload the guard would have blocked', async () => {
    envMock.DEID_FAIL_CLOSED = false
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    })

    await expect(client().generate(request(SMUGGLED))).resolves.toEqual({ ok: true })
    expect(completionsCreate).toHaveBeenCalledTimes(1)
  })
})
