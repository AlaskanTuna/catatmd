import { BATCH_ASR_UPLOAD_URL, type BatchSession } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcribeRecording } from './elevenlabs-batch.js'

/**
 * The SPA's only cross-origin fetch (#436), pinned the way `soniox-stream.ts`
 * pins the only socket: what it sends, how, where, and that a failure never
 * reads the vendor's own text.
 */

const SESSION: BatchSession = {
  provider: 'elevenlabs',
  uploadUrl: BATCH_ASR_UPLOAD_URL,
  token: 'single-use-abc',
  config: {
    modelId: 'scribe_v2',
    diarize: true,
    numSpeakers: 2,
    timestampsGranularity: 'word',
    tagAudioEvents: false,
    keyterms: ['batuk', 'sakit tekak'],
  },
}

const RECORDING = new Blob(['webm-bytes'], { type: 'audio/webm;codecs=opus' })

/** A string that must never surface anywhere the caller can see. */
const VENDOR_TEXT = 'MARKER_VENDOR_BODY_6610 invalid token'

const network = vi.fn<typeof fetch>()

beforeEach(() => {
  network.mockReset()
  vi.stubGlobal('fetch', network)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const WORDS = [
  { text: 'Ada', start: 0, end: 0.3, type: 'word', speaker_id: 'speaker_1', logprob: -0.1 },
  { text: ' ', start: 0.3, end: 0.4, type: 'spacing', speaker_id: 'speaker_1' },
  { text: 'batuk', start: 0.4, end: 0.8, type: 'word', speaker_id: 'speaker_1' },
]

const sentForm = (): FormData => {
  const body = network.mock.calls[0]?.[1]?.body
  expect(body).toBeInstanceOf(FormData)
  return body as FormData
}

describe('transcribeRecording, the request', () => {
  it('posts to the pinned address, with the token as the only addition', async () => {
    network.mockResolvedValue(jsonResponse({ words: WORDS }))

    await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    const [url, init] = network.mock.calls[0] ?? []
    const target = new URL(String(url))
    expect(`${target.origin}${target.pathname}`).toBe(BATCH_ASR_UPLOAD_URL)
    expect([...target.searchParams]).toEqual([['token', 'single-use-abc']])
    expect(init?.method).toBe('POST')
  })

  it('sends no cookie, follows no redirect, and names no referrer', async () => {
    network.mockResolvedValue(jsonResponse({ words: WORDS }))
    const controller = new AbortController()

    await transcribeRecording(SESSION, RECORDING, controller.signal)

    const init = network.mock.calls[0]?.[1]
    expect(init?.credentials).toBe('omit')
    expect(init?.redirect).toBe('error')
    expect(init?.referrerPolicy).toBe('no-referrer')
    expect(init?.signal).toBe(controller.signal)
    // No header is set by hand: no Authorization, and the browser writes the
    // multipart boundary itself.
    expect(init?.headers).toBeUndefined()
  })

  it('carries exactly the configured fields and the recording', async () => {
    network.mockResolvedValue(jsonResponse({ words: WORDS }))

    await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    const form = sentForm()
    expect([...new Set([...form.keys()])].sort()).toEqual(
      [
        'diarize',
        'file',
        'keyterms',
        'model_id',
        'num_speakers',
        'tag_audio_events',
        'timestamps_granularity',
      ].sort(),
    )
    expect(form.get('model_id')).toBe('scribe_v2')
    expect(form.get('diarize')).toBe('true')
    expect(form.get('num_speakers')).toBe('2')
    expect(form.get('timestamps_granularity')).toBe('word')
    expect(form.get('tag_audio_events')).toBe('false')
    expect(form.getAll('keyterms')).toEqual(['batuk', 'sakit tekak'])
    const file = form.get('file') as File
    expect(file.name).toBe('recording.webm')
    expect(file.size).toBe(RECORDING.size)
  })

  it.each([
    ['another host', { uploadUrl: 'https://evil.example/v1/speech-to-text' }],
    [
      'the residency host',
      { uploadUrl: 'https://api.sg.residency.elevenlabs.io/v1/speech-to-text' },
    ],
    ['the medical model', { config: { ...SESSION.config, modelId: 'scribe_v2_medical' } }],
    ['speaker roles', { config: { ...SESSION.config, detectSpeakerRoles: true } }],
  ])('refuses a session naming %s, before anything is sent', async (_label, change) => {
    const result = await transcribeRecording(
      { ...SESSION, ...change } as BatchSession,
      RECORDING,
      new AbortController().signal,
    )

    expect(result).toEqual({ ok: false, reason: 'refused', sent: false })
    expect(network).not.toHaveBeenCalled()
  })
})

describe('transcribeRecording, the response', () => {
  it('keeps the words and strips every field it does not use', async () => {
    network.mockResolvedValue(
      jsonResponse({ text: VENDOR_TEXT, language_code: 'ms', words: WORDS, transcription_id: 'x' }),
    )

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(result).toEqual({
      ok: true,
      sent: true,
      words: [
        { text: 'Ada', start: 0, end: 0.3, type: 'word', speaker_id: 'speaker_1' },
        { text: ' ', start: 0.3, end: 0.4, type: 'spacing', speaker_id: 'speaker_1' },
        { text: 'batuk', start: 0.4, end: 0.8, type: 'word', speaker_id: 'speaker_1' },
      ],
    })
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [403, 'rejected'],
    [413, 'rejected'],
    [422, 'rejected'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s without reading the body', async (status, reason) => {
    const response = jsonResponse({ detail: VENDOR_TEXT }, status)
    const json = vi.spyOn(response, 'json')
    const text = vi.spyOn(response, 'text')
    network.mockResolvedValue(response)

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(result).toEqual({ ok: false, reason, sent: true })
    expect(json).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })

  it('reports a network failure as unavailable, and the upload as sent', async () => {
    // The bytes may have left before the connection failed, so the record of
    // an egress must not depend on the reply.
    network.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(result).toEqual({ ok: false, reason: 'unavailable', sent: true })
  })

  it('reports an abort as aborted', async () => {
    const controller = new AbortController()
    network.mockImplementation(async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const result = await transcribeRecording(SESSION, RECORDING, controller.signal)

    expect(result).toEqual({ ok: false, reason: 'aborted', sent: true })
  })

  it('treats a non-JSON success as an invalid response', async () => {
    network.mockResolvedValue(new Response(VENDOR_TEXT, { status: 200 }))

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(result).toEqual({ ok: false, reason: 'invalid_response', sent: true })
  })

  it.each([
    ['no words array', { text: 'hello' }],
    ['an unknown element type', { words: [{ text: 'x', start: 0, end: 1, type: 'emotion' }] }],
    ['a word with no text', { words: [{ start: 0, end: 1, type: 'word' }] }],
  ])('treats %s as an invalid response', async (_label, body) => {
    network.mockResolvedValue(jsonResponse(body))

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(result).toEqual({ ok: false, reason: 'invalid_response', sent: true })
  })

  it('never returns vendor text in a failure', async () => {
    network.mockResolvedValue(jsonResponse({ detail: VENDOR_TEXT }, 401))

    const result = await transcribeRecording(SESSION, RECORDING, new AbortController().signal)

    expect(JSON.stringify(result)).not.toContain(VENDOR_TEXT)
  })
})
