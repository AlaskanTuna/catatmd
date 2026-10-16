import { readFileSync } from 'node:fs'
import { BATCH_ASR_UPLOAD_URL, BatchAsrConfigSchema } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BATCH_API_ORIGIN,
  batchRefinementConfig,
  ElevenLabsMintError,
  getBatchAsrDescriptor,
  mintBatchToken,
} from './elevenlabs.js'
import { asrContextTerms } from './vocabulary.js'

/**
 * The batch refinement adapter (#436, docs/trd.md §20.14), mirroring
 * `soniox.test.ts`: the CSP pin, the config literals that cross the egress,
 * and a mint that never reads an error body.
 *
 * The env module is mocked so a real key in the root `.env` can never decide a
 * test, exactly as the Soniox suite does.
 */
const testEnv = vi.hoisted(() => ({
  ELEVENLABS_API_KEY: 'test-elevenlabs-key' as string | undefined,
}))

vi.mock('../../config/env.js', () => ({ env: testEnv }))

/** A string that must never surface in a thrown message. */
const UPSTREAM_BODY_MARKER = 'MARKER_UPSTREAM_BODY_7720 invalid key xi-live-abcdef'

const upstream = vi.fn<typeof fetch>()

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mintError = async (): Promise<ElevenLabsMintError> => {
  const caught = await mintBatchToken().then(
    () => null,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(ElevenLabsMintError)
  return caught as ElevenLabsMintError
}

beforeAll(() => {
  vi.stubGlobal('fetch', upstream)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  upstream.mockReset()
  testEnv.ELEVENLABS_API_KEY = 'test-elevenlabs-key'
})

/** The deployed `connect-src` directive, split into its sources. */
function connectSources(): string[] {
  const policy = JSON.parse(
    readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'),
  ) as { headers: { headers: { key: string; value: string }[] }[] }
  const csp = policy.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === 'Content-Security-Policy')?.value
  const directive = csp
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'))
  expect(directive, 'no connect-src directive in vercel.json').toBeDefined()
  return directive?.split(/\s+/).slice(1) ?? []
}

describe('the upload host and the browser policy that must agree with it', () => {
  it('is reachable under the deployed content-security policy, by its exact origin', () => {
    /*
     * The coupling `soniox.test.ts` pins for the socket, pinned again for the
     * upload: the shared constant says where the browser is told to send the
     * recording, and `vercel.json` says where it is allowed to. Nothing but
     * this test makes the two files agree.
     */
    const origin = new URL(BATCH_ASR_UPLOAD_URL).origin
    expect(origin).toBe('https://api.elevenlabs.io')
    expect(
      connectSources(),
      `connect-src does not permit ${origin}, so refinement cannot upload on the deployed app`,
    ).toContain(origin)
  })

  it('names the host exactly, never a wildcard over the vendor', () => {
    // A wildcard would admit the residency hosts and any other subdomain, so
    // the platform layer would stop pinning where patient audio may go.
    const vendor = connectSources().filter((source) => source.includes('elevenlabs'))
    expect(vendor).toEqual(['https://api.elevenlabs.io'])
  })

  it('mints on the same host the browser uploads to', () => {
    expect(BATCH_API_ORIGIN).toBe(new URL(BATCH_ASR_UPLOAD_URL).origin)
  })
})

describe('batchRefinementConfig, which crosses the egress with the recording', () => {
  it('is the configuration the plan pinned, written out', () => {
    expect(batchRefinementConfig()).toEqual({
      modelId: 'scribe_v2',
      diarize: true,
      numSpeakers: 2,
      timestampsGranularity: 'word',
      tagAudioEvents: false,
      keyterms: asrContextTerms(),
    })
  })

  it('passes the shared literal schema the browser re-checks', () => {
    expect(BatchAsrConfigSchema.safeParse(batchRefinementConfig()).success).toBe(true)
  })

  it('carries the whole ambient vocabulary, each term inside the vendor bounds', () => {
    const { keyterms } = batchRefinementConfig()
    expect(keyterms).toHaveLength(asrContextTerms().length)
    for (const term of keyterms) {
      expect(term.length, term).toBeLessThan(50)
      expect(term.trim().split(/\s+/u).length, term).toBeLessThanOrEqual(5)
      expect(term, term).not.toMatch(/[<>{}[\]\\]/)
    }
  })

  it('hands out a fresh array on every call', () => {
    // A caller that mutated what it was handed would change what the next
    // consultation uploads under.
    const first = batchRefinementConfig()
    first.keyterms.push('mutated')
    expect(batchRefinementConfig().keyterms).not.toContain('mutated')
  })
})

describe('mintBatchToken, the outbound request', () => {
  it('posts to the single-use batch endpoint with the account key and no redirects', async () => {
    upstream.mockResolvedValue(jsonResponse({ token: 'single-use-abc' }))

    await mintBatchToken()

    const [url, init] = upstream.mock.calls[0] ?? []
    expect(url).toBe('https://api.elevenlabs.io/v1/single-use-token/batch_scribe')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'xi-api-key': 'test-elevenlabs-key' })
    // Following a redirect would re-post the account credential to whatever
    // host answered.
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    // Nothing a caller supplies reaches the vendor on this request.
    expect(init?.body).toBeUndefined()
  })

  it('bounds the mint at ten seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    upstream.mockResolvedValue(jsonResponse({ token: 'single-use-abc' }))

    await mintBatchToken()

    expect(timeout).toHaveBeenCalledWith(10_000)
    timeout.mockRestore()
  })

  it('makes exactly one attempt, with no retries', async () => {
    upstream.mockResolvedValue(jsonResponse({ detail: 'busy' }, 503))

    await mintError()

    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('never calls upstream without a key, and fails closed', async () => {
    testEnv.ELEVENLABS_API_KEY = undefined

    const error = await mintError()

    expect(error.reason).toBe('unavailable')
    expect(upstream).not.toHaveBeenCalled()
  })

  it('treats an empty key as no key', async () => {
    testEnv.ELEVENLABS_API_KEY = ''

    await mintError()

    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('mintBatchToken, the response', () => {
  it('keeps the token and strips everything else', async () => {
    upstream.mockResolvedValue(
      jsonResponse({ token: 'single-use-abc', expires_at: 'later', note: UPSTREAM_BODY_MARKER }),
    )

    const minted = await mintBatchToken()

    expect(minted).toEqual({ token: 'single-use-abc' })
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [402, 'rejected'],
    [403, 'rejected'],
    [404, 'rejected'],
    [422, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s without reading the body', async (status, reason) => {
    const response = jsonResponse({ detail: UPSTREAM_BODY_MARKER }, status)
    const read = vi.spyOn(response, 'json')
    const readText = vi.spyOn(response, 'text')
    upstream.mockResolvedValue(response)

    const error = await mintError()

    expect(error.reason).toBe(reason)
    expect(error.message).not.toContain(UPSTREAM_BODY_MARKER)
    expect(read).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
  })

  it('treats a network failure as unavailable', async () => {
    upstream.mockRejectedValue(new TypeError('fetch failed'))

    expect((await mintError()).reason).toBe('unavailable')
  })

  it('treats a timeout as unavailable', async () => {
    upstream.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    expect((await mintError()).reason).toBe('unavailable')
  })

  it('treats a non-JSON success as unavailable, without echoing it', async () => {
    upstream.mockResolvedValue(new Response(UPSTREAM_BODY_MARKER, { status: 200 }))

    const error = await mintError()

    expect(error.reason).toBe('unavailable')
    expect(error.message).not.toContain(UPSTREAM_BODY_MARKER)
  })

  it('treats a success missing the token as unavailable, without echoing it', async () => {
    upstream.mockResolvedValue(jsonResponse({ note: UPSTREAM_BODY_MARKER }))

    const error = await mintError()

    expect(error.reason).toBe('unavailable')
    expect(error.message).not.toContain(UPSTREAM_BODY_MARKER)
  })
})

describe('getBatchAsrDescriptor', () => {
  it('names the provider and model for audit stamps without touching the key', () => {
    testEnv.ELEVENLABS_API_KEY = undefined
    expect(getBatchAsrDescriptor()).toEqual({ provider: 'elevenlabs', model: 'scribe_v2' })
  })
})
