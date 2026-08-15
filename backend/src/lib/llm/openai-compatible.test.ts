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

const { completionsCreate, constructed, envMock } = vi.hoisted(() => ({
  completionsCreate: vi.fn(),
  constructed: vi.fn(),
  envMock: { DEID_FAIL_CLOSED: true },
}))

/**
 * Standing in for the SDK is what lets this assert on egress rather than on the
 * exception. If `completionsCreate` is never called, nothing reached the
 * network, which no amount of asserting on the thrown error can establish.
 *
 * `constructed` captures the client options for the same reason: the bounds in
 * issue #94 are only real if they reach the SDK, and the value they replace is
 * a default that is invisible at the call site.
 */
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: completionsCreate } }
    constructor(options: unknown) {
      constructed(options)
    }
  },
}))

vi.mock('../../config/env.js', () => ({ env: envMock }))

const { OpenAICompatibleClient } = await import('./openai-compatible.js')

const Schema = z.object({ ok: z.boolean() })

function client() {
  return new OpenAICompatibleClient('qwen', 'qwen3.7-flash', {
    apiKey: 'test-key',
    baseURL: 'https://example.invalid/v1',
    resolvesSchemaRefs: true,
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
  constructed.mockReset()
  envMock.DEID_FAIL_CLOSED = true
})

/**
 * GitHub issue #94. Inheriting the SDK defaults costs a 10-minute timeout with
 * two silent retries, and the SDK retries timeouts, so a provider that stops
 * responding holds one operation for roughly 30 minutes against CAP-1's
 * 30-second budget.
 *
 * These assert the values rather than merely that something was passed. A
 * regression here is silent by construction: dropping the options restores a
 * working client with defaults nobody chose, which no other test would notice.
 */
describe('every provider call is bounded in wall-clock time', () => {
  it('pins the request timeout instead of inheriting the SDK default', () => {
    client()

    expect(constructed).toHaveBeenCalledTimes(1)
    expect(
      constructed.mock.calls[0]?.[0],
      'Without an explicit timeout the SDK waits 10 minutes per attempt.',
    ).toMatchObject({ timeout: 60_000 })
  })

  it('pins maxRetries, which the SDK otherwise defaults to 2', () => {
    client()

    expect(
      constructed.mock.calls[0]?.[0],
      'Retries multiply the timeout, so an unpinned count is what turns ' + '10 minutes into 30.',
    ).toMatchObject({ maxRetries: 1 })
  })

  it('applies the bounds to every provider, not just the default one', () => {
    new OpenAICompatibleClient('deepseek', 'deepseek-v4-flash', {
      apiKey: 'test-key',
      baseURL: 'https://example.invalid/v1',
      resolvesSchemaRefs: false,
    })

    expect(
      constructed.mock.calls[0]?.[0],
      'The bounds live on the shared adapter precisely so a provider cannot ' +
        'be added without them.',
    ).toMatchObject({ maxRetries: 1, timeout: 60_000 })
  })
})

/**
 * GitHub issue #109. `clinical_facts` is 34 copies of one assertion object, so
 * whether a repeated shape is inlined or referenced decides the size of the
 * largest prompt in the system: 14,240 B against 3,558 B, measured 15/08/26.
 *
 * Pinned per provider because it is a capability, not a preference, and the
 * two failure directions are both silent from inside this repo. Sending refs
 * to Gemini fails as a bodiless HTTP 400 that names nothing; sending inlined
 * schemas to Qwen works perfectly and merely costs four times the prompt for
 * every consultation, which no test would otherwise notice.
 */
describe('the emitted JSON Schema matches what the provider can resolve', () => {
  /**
   * Two properties holding **one** schema instance, so `reused` has something
   * to collapse. It deduplicates by instance rather than by structure, so two
   * separately constructed but identical `z.object`s emit twice and no `$ref`
   * appears. `buildClinicalFacts` passes one `field` into all 34 keys, which
   * is why the real schema collapses; a refactor that built a fresh assertion
   * per key would silently restore the 14,240 B prompt.
   */
  const Leaf = z.object({ n: z.number() })
  const Repeated = z.object({ a: Leaf, b: Leaf })

  async function emittedFor(resolvesSchemaRefs: boolean) {
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"a":{"n":1},"b":{"n":2}}' }, finish_reason: 'stop' }],
    })
    const adapter = new OpenAICompatibleClient('qwen', 'test-model', {
      apiKey: 'test-key',
      baseURL: 'https://example.invalid/v1',
      resolvesSchemaRefs,
    })
    await adapter.generate({
      ...request(deidentify('nothing identifying here').text),
      schema: Repeated,
    })
    return JSON.stringify(completionsCreate.mock.calls[0]?.[0]?.response_format)
  }

  it('references a repeated shape when the provider resolves refs', async () => {
    expect(await emittedFor(true)).toContain('$ref')
  })

  it('inlines every copy when the provider does not', async () => {
    // Gemini's position. It accepts an unused `definitions` block and rejects
    // any pointer into one, so the only safe form is full inlining.
    expect(await emittedFor(false)).not.toContain('$ref')
  })

  it('keeps the inlined form when referencing would make the schema bigger', async () => {
    // `note_and_gaps` is the real instance of this: 686 B inlined against
    // 749 B referenced, because one lightly reused shape costs more in
    // pointers than it saves in duplication. It is also the call that writes
    // the prose, so leaving its request byte-identical is what keeps this
    // change off the note-quality surface entirely.
    const Once = z.object({ only: z.object({ n: z.number() }) })
    completionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"only":{"n":1}}' }, finish_reason: 'stop' }],
    })
    const adapter = new OpenAICompatibleClient('qwen', 'test-model', {
      apiKey: 'test-key',
      baseURL: 'https://example.invalid/v1',
      resolvesSchemaRefs: true,
    })

    await adapter.generate({
      ...request(deidentify('nothing identifying here').text),
      schema: Once,
    })

    const sent = JSON.stringify(completionsCreate.mock.calls[0]?.[0]?.response_format)
    expect(sent).not.toContain('$ref')
    expect(sent).toContain(JSON.stringify(z.toJSONSchema(Once, { target: 'draft-7' })))
  })
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
