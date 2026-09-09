import { readFileSync } from 'node:fs'
import { MAX_ASR_CONTEXT_TERMS } from '@shared/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFUSABLE_TARGETS } from '../../redflags/mishears.js'
import {
  getLiveAsrDescriptor,
  liveSessionConfig,
  MAX_SESSION_DURATION_SECONDS,
  mintSonioxSession,
  SonioxMintError,
  sonioxHosts,
  TEMPORARY_KEY_TTL_SECONDS,
} from './soniox.js'
import { asrContextTerms } from './vocabulary.js'

/**
 * The adapter reads only the three Soniox fields, and the mock is what keeps
 * this suite identical everywhere: a real key may sit in the root `.env` and
 * never in CI, and neither may decide a test.
 */
const testEnv = vi.hoisted(() => ({
  SONIOX_API_KEY: 'test-soniox-key' as string | undefined,
  SONIOX_REGION: 'us' as 'us' | 'eu' | 'jp' | 'in',
  SONIOX_RT_MODEL: 'stt-rt-v5',
}))

vi.mock('../../config/env.js', () => ({ env: testEnv }))

/** A string that must never surface in a thrown message. */
const UPSTREAM_BODY_MARKER = 'MARKER_UPSTREAM_BODY_5518 pesakit demam tiga hari'

/**
 * The region a deployment gets when it sets none, which is what `render.yaml`
 * and `.env.example` both carry and therefore what the CSP must permit.
 */
const EnvSchemaDefaultRegion = 'us' as const

const upstream = vi.fn<typeof fetch>()

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mintError = async (): Promise<SonioxMintError> => {
  const caught = await mintSonioxSession().then(
    () => null,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(SonioxMintError)
  return caught as SonioxMintError
}

const sentBody = (): Record<string, unknown> =>
  JSON.parse(String(upstream.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

beforeAll(() => {
  vi.stubGlobal('fetch', upstream)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  upstream.mockReset()
  testEnv.SONIOX_API_KEY = 'test-soniox-key'
  testEnv.SONIOX_REGION = 'us'
})

describe('sonioxHosts', () => {
  it('derives both hosts from the region enum, never from free text', () => {
    expect(sonioxHosts('us')).toEqual({
      api: 'https://api.soniox.com',
      websocket: 'wss://stt-rt.soniox.com/transcribe-websocket',
    })
    expect(sonioxHosts('eu')).toEqual({
      api: 'https://api.eu.soniox.com',
      websocket: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
    })
    expect(sonioxHosts('jp').websocket).toBe('wss://stt-rt.jp.soniox.com/transcribe-websocket')
    expect(sonioxHosts('in').api).toBe('https://api.in.soniox.com')
  })

  it('produces socket addresses the shared contract accepts', async () => {
    // The client refuses any other host, so a region whose address the schema
    // rejects would fail in the browser rather than here.
    const { LIVE_ASR_WEBSOCKET_URL } = await import('@shared/types')
    for (const region of ['us', 'eu', 'jp', 'in'] as const) {
      expect(sonioxHosts(region).websocket).toMatch(LIVE_ASR_WEBSOCKET_URL)
    }
  })
})

describe('the region and the browser policy that must agree with it', () => {
  it('is reachable under the deployed content-security policy', () => {
    /*
     * The coupling this pins: the region decides which host the browser is
     * told to open, and `vercel.json` decides which host the browser is
     * *allowed* to open. They are two files, and nothing but this test makes
     * them agree. A mismatch fails closed, which is the right direction, but
     * it fails in the browser at record time, in front of a patient, which is
     * the wrong place to discover it.
     */
    const policy = JSON.parse(
      readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'),
    ) as { headers: { headers: { key: string; value: string }[] }[] }

    const csp = policy.headers
      .flatMap((entry) => entry.headers)
      .find((header) => header.key === 'Content-Security-Policy')?.value
    const connectSrc = csp
      ?.split(';')
      .find((directive) => directive.trim().startsWith('connect-src'))

    const host = new URL(sonioxHosts(EnvSchemaDefaultRegion).websocket).origin
    expect(connectSrc, 'no connect-src directive in vercel.json').toBeDefined()
    expect(
      connectSrc,
      `connect-src does not permit ${host}, so ambient capture cannot open its socket on the deployed app`,
    ).toContain(host)
  })
})

describe('mintSonioxSession, the outbound request', () => {
  it('posts to the regional mint endpoint with the account key and no redirects', async () => {
    upstream.mockResolvedValue(jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }))

    await mintSonioxSession()

    const [url, init] = upstream.mock.calls[0] ?? []
    expect(url).toBe('https://api.soniox.com/v1/auth/temporary-api-key')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test-soniox-key',
      'Content-Type': 'application/json',
    })
    // Following a redirect would re-post the account credential to whatever
    // host answered.
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('asks for a short-lived key with a session cap and a server-generated reference', async () => {
    upstream.mockResolvedValue(jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }))

    const session = await mintSonioxSession()

    const body = sentBody()
    expect(body.usage_type).toBe('transcribe_websocket')
    expect(body.expires_in_seconds).toBe(TEMPORARY_KEY_TTL_SECONDS)
    // Short because a key was measured opening more than one connection: the
    // TTL is the width of the window, not a per-session bound.
    expect(TEMPORARY_KEY_TTL_SECONDS).toBeLessThanOrEqual(30)
    expect(body.max_session_duration_seconds).toBe(MAX_SESSION_DURATION_SECONDS)
    // The reference id is ours, not the client's: it is what reconciles our
    // audit row against the provider's usage log.
    expect(body.client_reference_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.clientReferenceId).toBe(body.client_reference_id)
  })

  it('mints a distinct reference for every session', async () => {
    // A fresh Response per call: a body can only be read once, so a shared one
    // would make the second mint fail for a reason unrelated to the assertion.
    upstream.mockImplementation(async () =>
      jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }),
    )

    const first = await mintSonioxSession()
    const second = await mintSonioxSession()

    expect(first.clientReferenceId).not.toBe(second.clientReferenceId)
  })

  it('follows the configured region', async () => {
    testEnv.SONIOX_REGION = 'jp'
    upstream.mockResolvedValue(jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }))

    await mintSonioxSession()

    expect(upstream.mock.calls[0]?.[0]).toBe('https://api.jp.soniox.com/v1/auth/temporary-api-key')
  })

  it('never calls upstream without a key, and fails closed', async () => {
    testEnv.SONIOX_API_KEY = undefined

    const error = await mintError()

    expect(error.reason).toBe('unavailable')
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('mintSonioxSession, the response', () => {
  it('maps the wire shape and strips everything else', async () => {
    // 201 rather than 200: measured against the real endpoint 06/09/26. The
    // adapter keys on `response.ok`, so the whole 2xx range works, and pinning
    // the observed status here keeps that deliberate rather than accidental.
    upstream.mockResolvedValue(
      jsonResponse(
        {
          api_key: 'temp-abc',
          expires_at: '2026-09-06T12:01:00Z',
          quota_note: UPSTREAM_BODY_MARKER,
        },
        201,
      ),
    )

    const session = await mintSonioxSession()

    expect(session.apiKey).toBe('temp-abc')
    expect(session.expiresAt).toBe('2026-09-06T12:01:00Z')
    expect(JSON.stringify(session)).not.toContain(UPSTREAM_BODY_MARKER)
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [402, 'rejected'],
    [403, 'rejected'],
    [404, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s without quoting the body', async (status, reason) => {
    upstream.mockResolvedValue(jsonResponse({ detail: UPSTREAM_BODY_MARKER }, status))

    const error = await mintError()

    expect(error.reason).toBe(reason)
    expect(error.message).not.toContain(UPSTREAM_BODY_MARKER)
    expect(error.message).toContain(String(status))
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

  it('treats a success missing the key as unavailable, without echoing it', async () => {
    upstream.mockResolvedValue(jsonResponse({ expires_at: 'later', note: UPSTREAM_BODY_MARKER }))

    const error = await mintError()

    expect(error.reason).toBe('unavailable')
    // A Zod issue can quote the value it received, so the message is fixed.
    expect(error.message).not.toContain(UPSTREAM_BODY_MARKER)
  })
})

describe('liveSessionConfig', () => {
  it('names the model from the environment and the constrained language set', () => {
    expect(liveSessionConfig()).toEqual({
      model: 'stt-rt-v5',
      languageHints: ['ms', 'en', 'zh', 'ta'],
      languageIdentification: true,
      speakerDiarization: true,
      endpointDetection: false,
      context: {
        general: [
          { key: 'domain', value: 'Healthcare' },
          { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
        ],
        terms: asrContextTerms(),
      },
    })
  })

  it('takes no arguments, which is what keeps a consultation out of the egress', () => {
    // The comment above `CONTEXT` says this structurally prevents request data
    // reaching a value that crosses the audio egress. Pinned as a test at the
    // moment the feature adds pressure to make the vocabulary per-session:
    // a reviewer reading a diff that adds a parameter sees this fail.
    expect(liveSessionConfig.length).toBe(0)
  })

  it('primes every word the confusable table exists to recover', () => {
    // Layer 1 aims at the target and layer 2 catches the miss, so a target the
    // recogniser was never primed for is a gap in the chain rather than two
    // independent defences. Derived on both sides, so this cannot drift.
    const terms = liveSessionConfig().context.terms ?? []

    for (const target of CONFUSABLE_TARGETS) {
      expect(terms).toContain(target)
    }
  })

  it('stays inside the vendor context budget', () => {
    // The whole context is capped at roughly 10,000 characters, shared with
    // `general`. Measured as sent rather than as a term count, because a term
    // is a phrase here and a count would not catch a long one.
    const { terms, general } = liveSessionConfig().context
    const sent = [...(terms ?? []), ...general.map((entry) => `${entry.key}${entry.value}`)].join()

    expect(terms?.length ?? 0).toBeLessThanOrEqual(MAX_ASR_CONTEXT_TERMS)
    expect(sent.length).toBeLessThan(10_000)
  })

  it('carries no duplicates, so the budget is not spent twice on one word', () => {
    const terms = liveSessionConfig().context.terms ?? []

    expect(new Set(terms).size).toBe(terms.length)
  })

  it('excludes Indonesian, which Malay is measurably confused with', () => {
    // Issue #218 measured Malay tagged Indonesian on 3 of 4 clips; the
    // documented mitigation is to constrain the candidate set.
    expect(liveSessionConfig().languageHints).not.toContain('id')
  })

  it('leaves endpoint detection off, because it freezes speaker ids', () => {
    // With it on the vendor finalises tokens early, and a final token is never
    // revised, so a temporary speaker switch becomes permanent for the rest of
    // the consultation. Pinned here because the symptom is only observable in
    // a live capture: nothing else in this suite can catch a regression.
    expect(liveSessionConfig().endpointDetection).toBe(false)
  })

  it('hands out a fresh context each call, so no caller can poison the next', () => {
    // The hint crosses the audio egress, where nothing can be de-identified.
    // Taking no arguments is what keeps request data out of it; this is the
    // other half, so a caller that mutates what it was handed cannot change
    // what the next session sends.
    const first = liveSessionConfig()
    first.context.general[0] = { key: 'patient', value: 'leaked' }
    first.context.general.push({ key: 'extra', value: 'leaked' })
    first.context.terms?.push('Encik Ahmad bin Ismail')

    expect(liveSessionConfig().context).toEqual({
      general: [
        { key: 'domain', value: 'Healthcare' },
        { key: 'speakers', value: 'Two speakers: a doctor and a patient' },
      ],
      terms: asrContextTerms(),
    })
    expect(liveSessionConfig().context.terms).not.toContain('Encik Ahmad bin Ismail')
  })
})

describe('getLiveAsrDescriptor', () => {
  it('reads the environment without touching the key, so an audit stamp cannot fail', () => {
    testEnv.SONIOX_API_KEY = undefined
    testEnv.SONIOX_REGION = 'eu'

    expect(getLiveAsrDescriptor()).toEqual({
      provider: 'soniox',
      model: 'stt-rt-v5',
      region: 'eu',
    })
  })
})
