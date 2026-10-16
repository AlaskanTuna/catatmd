import { describe, expect, it } from 'vitest'
import {
  BATCH_ASR_UPLOAD_URL,
  BatchAsrConfigSchema,
  BatchSessionRequestSchema,
  BatchSessionSchema,
  LiveAsrConfigSchema,
  MAX_ASR_CONTEXT_TERMS,
  MAX_BATCH_RECORDING_SECONDS,
  MAX_REFINEMENT_CHECK_CHARACTERS,
  MAX_REFINEMENT_CHECK_TURNS,
  RefinementCheckRequestSchema,
  RefinementCheckResponseSchema,
  TranscriptSchema,
} from './index.js'

/**
 * The contracts for refining an ambient transcript after Stop (#436).
 *
 * The property most worth pinning is the one the browser relies on: the
 * recognition settings it uploads under are literals, so even a response from
 * our own API cannot ask for the medical model, which merges voices, or for
 * speaker roles, which would be a second role mechanism.
 */

const CONFIG = {
  modelId: 'scribe_v2',
  diarize: true,
  numSpeakers: 2,
  timestampsGranularity: 'word',
  tagAudioEvents: false,
  keyterms: ['batuk', 'sakit tekak', 'demam'],
} as const

describe('BATCH_ASR_UPLOAD_URL', () => {
  it('is the one exact address the browser may upload a recording to', () => {
    expect(BATCH_ASR_UPLOAD_URL).toBe('https://api.elevenlabs.io/v1/speech-to-text')
  })
})

describe('BatchAsrConfigSchema', () => {
  it('accepts the configuration the plan pinned', () => {
    expect(BatchAsrConfigSchema.safeParse(CONFIG).success).toBe(true)
  })

  it.each([
    ['the medical model, which merges voices', { modelId: 'scribe_v2_medical' }],
    ['the realtime model', { modelId: 'scribe_v2_realtime' }],
    ['diarisation off', { diarize: false }],
    ['a third speaker', { numSpeakers: 3 }],
    ['no word timing', { timestampsGranularity: 'none' }],
    ['audio events tagged into the text', { tagAudioEvents: true }],
  ])('refuses %s', (_label, change) => {
    expect(BatchAsrConfigSchema.safeParse({ ...CONFIG, ...change }).success).toBe(false)
  })

  it('refuses speaker roles even when every other field is right', () => {
    // Roles would be a second role mechanism beside `voteRolesBySpeaker`.
    expect(BatchAsrConfigSchema.safeParse({ ...CONFIG, detectSpeakerRoles: true }).success).toBe(
      false,
    )
  })

  it.each([
    ['fifty characters', 'x'.repeat(50)],
    ['six words', 'one two three four five six'],
    ['an angle bracket', '<script>'],
    ['a brace', 'demam {x}'],
    ['a square bracket', 'batuk [1]'],
    ['a backslash', 'sakit\\tekak'],
    ['an empty term', ''],
  ])('refuses a keyterm with %s', (_label, term) => {
    expect(BatchAsrConfigSchema.safeParse({ ...CONFIG, keyterms: [term] }).success).toBe(false)
  })

  it('accepts a keyterm of forty-nine characters and five words', () => {
    const term = `${'a'.repeat(9)} ${'b'.repeat(9)} ${'c'.repeat(9)} ${'d'.repeat(9)} ${'e'.repeat(9)}`
    expect(term.length).toBe(49)
    expect(BatchAsrConfigSchema.safeParse({ ...CONFIG, keyterms: [term] }).success).toBe(true)
  })
})

describe('BatchSessionRequestSchema', () => {
  it('requires asserted consent and a bounded duration', () => {
    expect(
      BatchSessionRequestSchema.safeParse({ consent: true, durationSeconds: 300 }).success,
    ).toBe(true)
    expect(BatchSessionRequestSchema.safeParse({ durationSeconds: 300 }).success).toBe(false)
    expect(
      BatchSessionRequestSchema.safeParse({ consent: false, durationSeconds: 300 }).success,
    ).toBe(false)
    expect(BatchSessionRequestSchema.safeParse({ consent: true }).success).toBe(false)
  })

  it.each([0, -1, 1.5, MAX_BATCH_RECORDING_SECONDS + 1, Number.POSITIVE_INFINITY])(
    'refuses a duration of %s',
    (durationSeconds) => {
      expect(BatchSessionRequestSchema.safeParse({ consent: true, durationSeconds }).success).toBe(
        false,
      )
    },
  )

  it('accepts the longest recording an ambient session can produce, plus slack', () => {
    // The ambient session cap is 1800 s; the bound leaves a minute for the
    // recorder's last chunk and the stop drain.
    expect(MAX_BATCH_RECORDING_SECONDS).toBe(1_860)
    expect(
      BatchSessionRequestSchema.safeParse({
        consent: true,
        durationSeconds: MAX_BATCH_RECORDING_SECONDS,
      }).success,
    ).toBe(true)
  })
})

describe('BatchSessionSchema', () => {
  const session = {
    provider: 'elevenlabs',
    uploadUrl: BATCH_ASR_UPLOAD_URL,
    token: 'single-use-token',
    config: CONFIG,
  }

  it('accepts a session naming the pinned address', () => {
    expect(BatchSessionSchema.safeParse(session).success).toBe(true)
  })

  it.each([
    'https://api.elevenlabs.io/v1/speech-to-text?x=1',
    'https://api.elevenlabs.io/v1/speech-to-text/',
    'https://api.sg.residency.elevenlabs.io/v1/speech-to-text',
    'http://api.elevenlabs.io/v1/speech-to-text',
    'https://evil.example/v1/speech-to-text',
  ])('refuses any other upload address, %s', (uploadUrl) => {
    expect(BatchSessionSchema.safeParse({ ...session, uploadUrl }).success).toBe(false)
  })

  it('refuses a session whose config asks for the medical model', () => {
    expect(
      BatchSessionSchema.safeParse({
        ...session,
        config: { ...CONFIG, modelId: 'scribe_v2_medical' },
      }).success,
    ).toBe(false)
  })

  it('refuses a token past its bound', () => {
    expect(BatchSessionSchema.safeParse({ ...session, token: 'x'.repeat(4_097) }).success).toBe(
      false,
    )
  })

  it('refuses more keyterms than the vocabulary bound', () => {
    const keyterms = Array.from({ length: MAX_ASR_CONTEXT_TERMS + 1 }, (_, i) => `term ${i}`)
    expect(BatchAsrConfigSchema.safeParse({ ...CONFIG, keyterms }).success).toBe(false)
  })

  it('refuses an empty token', () => {
    expect(BatchSessionSchema.safeParse({ ...session, token: '' }).success).toBe(false)
  })
})

describe('LiveAsrConfigSchema.batchRefinement', () => {
  it('is optional, so an SPA reading an older API sees refinement as unavailable', () => {
    const config = {
      provider: 'soniox',
      region: 'us',
      websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
      config: {
        model: 'stt-rt-v5',
        languageHints: ['ms', 'en'],
        languageIdentification: true,
        speakerDiarization: true,
        endpointDetection: false,
        context: { general: [{ key: 'domain', value: 'Healthcare' }] },
      },
    }
    expect(LiveAsrConfigSchema.parse(config).batchRefinement).toBeUndefined()
    expect(LiveAsrConfigSchema.parse({ ...config, batchRefinement: true }).batchRefinement).toBe(
      true,
    )
  })
})

describe('TranscriptSchema.batchTranscription', () => {
  const transcript = {
    source: 'asr_live',
    turns: [{ speaker: 'patient', text: 'Batuk tiga hari.' }],
  }

  it('is optional, so transcripts stored before it existed still parse', () => {
    expect(TranscriptSchema.safeParse(transcript).success).toBe(true)
  })

  it('records whether the refined transcript was the one used', () => {
    expect(
      TranscriptSchema.parse({ ...transcript, batchTranscription: { used: false } })
        .batchTranscription,
    ).toEqual({ used: false })
    expect(TranscriptSchema.safeParse({ ...transcript, batchTranscription: {} }).success).toBe(
      false,
    )
  })
})

describe('RefinementCheckRequestSchema', () => {
  it('takes the live and refined turn texts', () => {
    expect(
      RefinementCheckRequestSchema.safeParse({
        live: ['Ada batuk sikit.'],
        refined: ['Ada batuk sikit.'],
      }).success,
    ).toBe(true)
  })

  it('refuses an empty side, an empty turn and an oversized turn', () => {
    expect(RefinementCheckRequestSchema.safeParse({ live: [], refined: ['x'] }).success).toBe(false)
    expect(RefinementCheckRequestSchema.safeParse({ live: [' '], refined: ['x'] }).success).toBe(
      false,
    )
    expect(
      RefinementCheckRequestSchema.safeParse({ live: ['x'.repeat(4_001)], refined: ['x'] }).success,
    ).toBe(false)
  })

  it('bounds the number of turns and the total text on each side', () => {
    const tooMany = Array.from({ length: MAX_REFINEMENT_CHECK_TURNS + 1 }, () => 'ya')
    expect(RefinementCheckRequestSchema.safeParse({ live: tooMany, refined: ['x'] }).success).toBe(
      false,
    )

    const long = 'x'.repeat(4_000)
    const tooMuch = Array.from(
      { length: Math.ceil(MAX_REFINEMENT_CHECK_CHARACTERS / 4_000) + 1 },
      () => long,
    )
    expect(RefinementCheckRequestSchema.safeParse({ live: ['x'], refined: tooMuch }).success).toBe(
      false,
    )
  })

  it('accepts exactly the character bound on a side', () => {
    const turn = 'x'.repeat(4_000)
    const atBound = Array.from({ length: MAX_REFINEMENT_CHECK_CHARACTERS / 4_000 }, () => turn)
    expect(atBound.join('').length).toBe(MAX_REFINEMENT_CHECK_CHARACTERS)
    expect(RefinementCheckRequestSchema.safeParse({ live: ['x'], refined: atBound }).success).toBe(
      true,
    )
  })

  it('carries no speaker, source or label review, which the server sets itself', () => {
    const parsed = RefinementCheckRequestSchema.parse({
      live: ['x'],
      refined: ['x'],
      labelsReviewed: true,
      source: 'paste',
    })
    expect(parsed).toEqual({ live: ['x'], refined: ['x'] })
  })
})

describe('RefinementCheckResponseSchema', () => {
  it('lists the rule hits the refined transcript lost', () => {
    expect(RefinementCheckResponseSchema.safeParse({ lost: [] }).success).toBe(true)
    expect(
      RefinementCheckResponseSchema.safeParse({
        lost: [
          {
            id: 'haemoptysis',
            label: 'Coughing up blood',
            severity: 'emergency',
            evidence: 'batuk berdarah',
            source: 'rule',
            ruleId: 'haemoptysis',
          },
        ],
      }).success,
    ).toBe(true)
    expect(RefinementCheckResponseSchema.safeParse({}).success).toBe(false)
  })
})
