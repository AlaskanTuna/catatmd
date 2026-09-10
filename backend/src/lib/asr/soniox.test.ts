import { readFileSync } from 'node:fs'
import {
  type LiveAsrMode,
  LiveAsrModeSchema,
  type LiveSessionConfig,
  MAX_ASR_CONTEXT_TERMS,
} from '@shared/types'
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
import { asrContextTerms, dictationContextTerms } from './vocabulary.js'

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

const mintError = async (mode: LiveAsrMode = 'ambient'): Promise<SonioxMintError> => {
  const caught = await mintSonioxSession(mode).then(
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

    await mintSonioxSession('ambient')

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

    const session = await mintSonioxSession('ambient')

    const body = sentBody()
    expect(body.usage_type).toBe('transcribe_websocket')
    expect(body.expires_in_seconds).toBe(TEMPORARY_KEY_TTL_SECONDS)
    // Short because a key was measured opening more than one connection: the
    // TTL is the width of the window, not a per-session bound.
    expect(TEMPORARY_KEY_TTL_SECONDS).toBeLessThanOrEqual(30)
    expect(body.max_session_duration_seconds).toBe(MAX_SESSION_DURATION_SECONDS.ambient)
    // The reference id is ours, not the client's: it is what reconciles our
    // audit row against the provider's usage log.
    expect(body.client_reference_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.clientReferenceId).toBe(body.client_reference_id)
  })

  it.each(LiveAsrModeSchema.options)(
    'binds the %s session cap to the key it mints',
    async (mode) => {
      // The provider binds this at mint time, so it cannot be chosen later: a
      // mode that reached the wire with the other's cap would be a spend control
      // that never applied. Written out rather than read from the table, so the
      // numbers themselves are pinned.
      const expected: Record<LiveAsrMode, number> = { ambient: 1_800, dictation: 120 }
      upstream.mockResolvedValue(jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }))

      await mintSonioxSession(mode)

      expect(sentBody().max_session_duration_seconds).toBe(expected[mode])
      expect(MAX_SESSION_DURATION_SECONDS[mode]).toBe(expected[mode])
    },
  )

  it('refuses an unknown mode before the account key reaches the wire', async () => {
    // The lookup guard, checked on the mint path as well as the config one: a
    // fallback here would send `undefined` as a duration, which is a session
    // with no cap at all.
    await expect(mintSonioxSession('ambient; patient=Encik Ahmad' as LiveAsrMode)).rejects.toThrow()

    expect(upstream).not.toHaveBeenCalled()
  })

  it('mints a distinct reference for every session', async () => {
    // A fresh Response per call: a body can only be read once, so a shared one
    // would make the second mint fail for a reason unrelated to the assertion.
    upstream.mockImplementation(async () =>
      jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }),
    )

    const first = await mintSonioxSession('ambient')
    const second = await mintSonioxSession('ambient')

    expect(first.clientReferenceId).not.toBe(second.clientReferenceId)
  })

  it('follows the configured region', async () => {
    testEnv.SONIOX_REGION = 'jp'
    upstream.mockResolvedValue(jsonResponse({ api_key: 'temp-abc', expires_at: 'later' }))

    await mintSonioxSession('ambient')

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

    const session = await mintSonioxSession('ambient')

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

/**
 * The config each mode sends, written out rather than read from the table it
 * is compared against.
 *
 * **A `Record` keyed on the enum, so a third mode is a compile error here until
 * someone writes its config down.** That is the property this file buys in
 * place of the arity pin it replaced: the risk was never that a caller passes
 * an argument, it was that something a caller supplies reaches a value crossing
 * the audio egress, and a mode whose config nobody spelled out is exactly that
 * hole one step earlier.
 *
 * `terms` is the one field referenced rather than transcribed. It is a hundred
 * and twenty derived strings whose contents `vocabulary.test.ts` owns; copying
 * them here would pin the wrong file and rot on the next lexicon entry. What is
 * pinned here is which builder each mode reads, which is the coupling that can
 * silently go wrong.
 */
const EXPECTED_CONFIG: Record<LiveAsrMode, LiveSessionConfig> = {
  ambient: {
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
  },
  dictation: {
    model: 'stt-rt-v5',
    languageHints: ['ms', 'en'],
    languageIdentification: true,
    speakerDiarization: false,
    endpointDetection: true,
    context: {
      general: [
        { key: 'domain', value: 'Healthcare' },
        { key: 'speakers', value: 'One speaker: a doctor dictating a prescription' },
      ],
      terms: dictationContextTerms(),
    },
  },
}

/**
 * Values a caller must never be able to push across the audio egress.
 *
 * Two are identifiers of the kind `deid/` exists to catch and which audio
 * structurally cannot be cleaned of; the third is the shape someone reaches for
 * when they have noticed that the argument selects a config and want to append
 * to it. All three are typed through `as LiveAsrMode`, because the compiler
 * already refuses them and the point is what happens when something upstream
 * has been widened and no longer does.
 */
const ADVERSARIAL_MODES = [
  '900101-14-5678',
  'Encik Ahmad bin Ismail',
  'ambient; patient=Encik Ahmad bin Ismail',
  // Not free text, and the reason `settingsFor` uses `Object.hasOwn`: a plain
  // object inherits these, so a truthiness check would resolve them to a
  // function instead of refusing.
  'constructor',
  'toString',
  '__proto__',
] as const

describe('liveSessionConfig', () => {
  it.each(LiveAsrModeSchema.options)('sends the written-down %s config', (mode) => {
    expect(liveSessionConfig(mode)).toEqual(EXPECTED_CONFIG[mode])
  })

  it('takes exactly one argument, and it is the closed enum', () => {
    // Arity zero was the old statement of "nothing a caller supplies reaches
    // the egress". One argument states the same property differently: a caller
    // picks which of two static constants is sent and never what is in either.
    // A second parameter is what would break that, so the number is pinned.
    expect(liveSessionConfig.length).toBe(1)
  })

  it.each(ADVERSARIAL_MODES)('throws on %s rather than falling back to a default', (mode) => {
    // A `?? AMBIENT` fallback is the specific defect the lookup exists to
    // prevent: it would egress one mode's config while the caller believed it
    // had asked for another's, and on this path there is no second chance to
    // notice.
    expect(() => liveSessionConfig(mode as LiveAsrMode)).toThrow()
  })

  it('cannot carry an adversarial mode into any config it does return', () => {
    // The other half of the throw: a thrown message that quoted the argument,
    // or a config that echoed it, would put an unvalidated string one drain
    // away from an identifier.
    for (const mode of LiveAsrModeSchema.options) {
      const sent = JSON.stringify(liveSessionConfig(mode))
      for (const adversarial of ADVERSARIAL_MODES) {
        expect(sent).not.toContain(adversarial)
      }
    }

    for (const adversarial of ADVERSARIAL_MODES) {
      const thrown = (() => {
        try {
          liveSessionConfig(adversarial as LiveAsrMode)
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })()

      expect(thrown).not.toContain(adversarial)
    }
  })

  it('primes every word the confusable table exists to recover', () => {
    // Layer 1 aims at the target and layer 2 catches the miss, so a target the
    // recogniser was never primed for is a gap in the chain rather than two
    // independent defences. Derived on both sides, so this cannot drift.
    // Ambient only: the confusable table is symptom vocabulary, and a dictated
    // prescription is a different domain (see `dictationContextTerms`).
    const terms = liveSessionConfig('ambient').context.terms ?? []

    for (const target of CONFUSABLE_TARGETS) {
      expect(terms).toContain(target)
    }
  })

  it.each(LiveAsrModeSchema.options)('keeps %s inside the vendor context budget', (mode) => {
    // The whole context is capped at roughly 10,000 characters, shared with
    // `general`. Measured as sent rather than as a term count, because a term
    // is a phrase here and a count would not catch a long one.
    const { terms, general } = liveSessionConfig(mode).context
    const sent = [...(terms ?? []), ...general.map((entry) => `${entry.key}${entry.value}`)].join()

    expect(terms?.length ?? 0).toBeLessThanOrEqual(MAX_ASR_CONTEXT_TERMS)
    expect(sent.length).toBeLessThan(10_000)
  })

  it.each(LiveAsrModeSchema.options)('spends no %s budget twice on one word', (mode) => {
    const terms = liveSessionConfig(mode).context.terms ?? []

    expect(new Set(terms).size).toBe(terms.length)
  })

  it.each(LiveAsrModeSchema.options)(
    'excludes Indonesian from %s, which Malay is measurably confused with',
    (mode) => {
      // Issue #218 measured Malay tagged Indonesian on 3 of 4 clips; the
      // documented mitigation is to constrain the candidate set.
      expect(liveSessionConfig(mode).languageHints).not.toContain('id')
    },
  )

  it('inverts both diarisation settings for dictation, and only together', () => {
    // With endpoint detection on the vendor finalises tokens early, and a final
    // token is never revised, so a temporary speaker switch becomes permanent
    // for the rest of the consultation. That cost is what keeps it off for
    // ambient, and it is conditional on there being a speaker id to freeze:
    // with diarisation off there is none, and what is left is `<end>` markers
    // settling a dictated phrase promptly. Pinned as a pair because turning one
    // on without the other is the regression, and neither symptom is
    // observable outside a live capture.
    expect(liveSessionConfig('ambient').speakerDiarization).toBe(true)
    expect(liveSessionConfig('ambient').endpointDetection).toBe(false)
    expect(liveSessionConfig('dictation').speakerDiarization).toBe(false)
    expect(liveSessionConfig('dictation').endpointDetection).toBe(true)
  })

  it.each(LiveAsrModeSchema.options)(
    'hands out a fresh %s context each call, so no caller can poison the next',
    (mode) => {
      // The hint crosses the audio egress, where nothing can be de-identified.
      // The closed enum is what keeps request data out of it; this is the other
      // half, so a caller that mutates what it was handed cannot change what
      // the next session sends.
      const first = liveSessionConfig(mode)
      first.context.general[0] = { key: 'patient', value: 'leaked' }
      first.context.general.push({ key: 'extra', value: 'leaked' })
      first.context.terms?.push('Encik Ahmad bin Ismail')

      expect(liveSessionConfig(mode).context).toEqual(EXPECTED_CONFIG[mode].context)
      expect(liveSessionConfig(mode).context.terms).not.toContain('Encik Ahmad bin Ismail')
    },
  )
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
