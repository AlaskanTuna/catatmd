import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAsrDescriptor, IlmuRelayError, transcribeWithIlmu } from './ilmu.js'

/**
 * The adapter under test reads only the three ILMU fields, and the mock is what
 * keeps this suite identical everywhere: locally the root `.env` carries a real
 * key while CI carries none, and neither may decide a test.
 */
const testEnv = vi.hoisted(() => ({
  ILMU_API_KEY: 'test-key' as string | undefined,
  ILMU_BASE_URL: 'https://ilmu.test/v1',
  ILMU_ASR_MODEL: 'ilmu-asr-v4.2',
}))

vi.mock('../../config/env.js', () => ({ env: testEnv }))

/** A string that must never surface in a thrown message. */
const UPSTREAM_BODY_MARKER = 'MARKER_UPSTREAM_BODY_7742 pesakit batuk teruk'

const upstream = vi.fn<typeof fetch>()

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const audio = Buffer.from('not-really-audio-bytes')

const transcribe = (contentType = 'audio/webm') => transcribeWithIlmu(audio, contentType)

const relayError = async (contentType = 'audio/webm'): Promise<IlmuRelayError> => {
  const caught = await transcribe(contentType).then(
    () => null,
    (error: unknown) => error,
  )
  expect(caught).toBeInstanceOf(IlmuRelayError)
  return caught as IlmuRelayError
}

beforeAll(() => {
  vi.stubGlobal('fetch', upstream)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  upstream.mockReset()
  testEnv.ILMU_API_KEY = 'test-key'
})

describe('transcribeWithIlmu, the wire shape (docs/trd.md §20.3 finding 5)', () => {
  it("maps today's actual response: text plus usage.seconds, no segments", async () => {
    upstream.mockResolvedValueOnce(
      jsonResponse({ text: 'batuk sudah tiga hari', usage: { type: 'duration', seconds: 99.2 } }),
    )

    await expect(transcribe()).resolves.toEqual({
      text: 'batuk sudah tiga hari',
      durationSeconds: 99.2,
      segments: [],
    })
  })

  it('tolerates the documented shape appearing later, mapping segments through', async () => {
    upstream.mockResolvedValueOnce(
      jsonResponse({
        text: 'a b',
        duration: 12,
        language: 'ms',
        segments: [
          { text: 'a', start: 0, end: 1.5 },
          { text: 'b', start: 1.5 },
        ],
      }),
    )

    await expect(transcribe()).resolves.toEqual({
      text: 'a b',
      durationSeconds: 12,
      segments: [
        { text: 'a', start: 0, end: 1.5 },
        { text: 'b', start: 1.5, end: null },
      ],
    })
  })

  it('prefers usage.seconds over the documented duration when both appear', async () => {
    upstream.mockResolvedValueOnce(
      jsonResponse({ text: 'x', usage: { type: 'duration', seconds: 83.4 }, duration: 80 }),
    )

    await expect(transcribe()).resolves.toMatchObject({ durationSeconds: 83.4 })
  })

  it('rejects a 200 that is not JSON, without quoting it', async () => {
    upstream.mockResolvedValueOnce(new Response(UPSTREAM_BODY_MARKER, { status: 200 }))

    const error = await relayError()
    expect(error.reason).toBe('unavailable')
    expect(error.message).not.toContain('MARKER_UPSTREAM_BODY_7742')
  })

  it('rejects a 200 that fails the schema, without quoting the payload', async () => {
    upstream.mockResolvedValueOnce(jsonResponse({ transcript: UPSTREAM_BODY_MARKER }))

    const error = await relayError()
    expect(error.reason).toBe('unavailable')
    expect(error.message).not.toContain('MARKER_UPSTREAM_BODY_7742')
  })
})

describe('transcribeWithIlmu, upstream failures', () => {
  it.each([
    [400, 'rejected_audio'],
    [402, 'no_allocation'],
    [413, 'too_large'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps upstream %i to reason %s, never reading the body', async (status, reason) => {
    upstream.mockResolvedValueOnce(new Response(UPSTREAM_BODY_MARKER, { status }))

    const error = await relayError()
    expect(error.reason).toBe(reason)
    expect(error.message).not.toContain('MARKER_UPSTREAM_BODY_7742')
    expect(error.message).toContain(String(status))
  })

  it('maps a network failure to unavailable', async () => {
    upstream.mockRejectedValueOnce(new TypeError('fetch failed'))

    const error = await relayError()
    expect(error.reason).toBe('unavailable')
  })

  it('maps a timeout to unavailable', async () => {
    upstream.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))

    const error = await relayError()
    expect(error.reason).toBe('unavailable')
  })

  it('fails closed without a key, before any fetch', async () => {
    testEnv.ILMU_API_KEY = undefined

    const error = await relayError()
    expect(error.reason).toBe('unavailable')
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('transcribeWithIlmu, the outbound request', () => {
  const sentRequest = async (contentType = 'audio/webm') => {
    upstream.mockResolvedValueOnce(jsonResponse({ text: 'x', usage: { seconds: 1 } }))
    await transcribe(contentType)
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit]
    return { url, init, form: init.body as FormData }
  }

  it('posts multipart to the configured endpoint with a bearer key and a timeout', async () => {
    const { url, init, form } = await sentRequest()

    expect(url).toBe('https://ilmu.test/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-key' })
    // A redirect would re-post patient audio to whatever host answered.
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('ilmu-asr-v4.2')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('temperature')).toBe('0')
    // No language hint in v1: measure before hinting (docs/trd.md §20.3).
    expect(form.get('language')).toBeNull()
  })

  it.each([
    ['audio/webm;codecs=opus', 'audio.webm'],
    ['audio/webm', 'audio.webm'],
    ['audio/mp4', 'audio.m4a'],
    ['audio/x-m4a', 'audio.m4a'],
    ['audio/mpeg', 'audio.mp3'],
    ['audio/wav', 'audio.wav'],
    ['audio/x-unknown', 'audio.x-unknown'],
  ] as const)('names the file part for %s as %s', async (contentType, filename) => {
    const { form } = await sentRequest(contentType)
    const file = form.get('file')

    expect(file).toBeInstanceOf(File)
    expect((file as File).name).toBe(filename)
    expect((file as File).type).toBe(contentType)
  })
})

describe('getAsrDescriptor', () => {
  it('names the provider and model without touching the key', () => {
    testEnv.ILMU_API_KEY = undefined

    expect(getAsrDescriptor()).toEqual({ provider: 'ilmu', model: 'ilmu-asr-v4.2' })
  })
})
