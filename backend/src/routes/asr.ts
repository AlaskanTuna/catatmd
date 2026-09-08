import {
  DraftTurnsRequestSchema,
  DraftTurnsResponseSchema,
  LiveAsrConfigSchema,
  LiveSessionRequestSchema,
  LiveSessionSchema,
} from '@shared/types'
import { type NextFunction, type Request, type Response, Router } from 'express'
import {
  type AsrRelayFailureReason,
  type LiveSessionFailureReason,
  recordAuditEvent,
} from '../audit/index.js'
import { env } from '../config/env.js'
import { DeidentificationError, deidentify } from '../deid/index.js'
import { DraftTurnsError, draftTurns } from '../draft-turns/index.js'
import { getAsrDescriptor, IlmuRelayError, transcribeWithIlmu } from '../lib/asr/ilmu.js'
import {
  getLiveAsrDescriptor,
  liveSessionConfig,
  MAX_SESSION_DURATION_SECONDS,
  mintSonioxSession,
  SonioxMintError,
  sonioxHosts,
} from '../lib/asr/soniox.js'
import { HttpError } from '../lib/http-error.js'
import { getLLMDescriptor } from '../lib/llm/index.js'
import { logger } from '../lib/logger.js'
import { inFlightGate, parseAudioBody } from '../middleware/audio-body.js'

export const asrRouter = Router()

/** `req.doctorId` is set by `requireSession`, which guards every route here. */
function doctorId(req: { doctorId?: string }): string {
  if (!req.doctorId) throw new HttpError(401, 'unauthenticated', 'Authentication required.')
  return req.doctorId
}

/**
 * The 25 MB cap, the `inflate: false` reasoning and the 413 mapping now live in
 * `middleware/audio-body.ts`, because consultation audio storage needs exactly
 * the same three (#293) and two copies would be two places for them to drift.
 * The reasoning is unchanged and is documented there.
 *
 * Two concurrent relays keeps the worst case (body plus the Blob snapshot, per
 * request) comfortably inside Render's 512 MB instance; the third caller gets a
 * clean 503 before any body is buffered, which beats an OOM that takes the
 * clinical routes down with it. Its own counter rather than one shared with the
 * storage routes, so a doctor uploading a recording can never be refused
 * transcription, or the other way round.
 */
const acquireRelaySlot = inFlightGate({
  limit: 2,
  code: 'asr_unavailable',
  message: 'Hosted transcription is busy. Retry shortly.',
})

/**
 * Feature gate ahead of the body parser: a deployment without an ILMU key
 * answers 503 without first buffering up to 25 MB it will not use. Fails
 * closed and visibly rather than silently (docs/trd.md §20).
 */
function requireIlmuConfigured(_req: Request, _res: Response, next: NextFunction) {
  if (!env.ILMU_API_KEY) {
    next(new HttpError(503, 'asr_unavailable', 'Hosted transcription is not available.'))
    return
  }
  next()
}

/**
 * Fixed responses per relay failure. Upstream text never passes through, and
 * `no_allocation` deliberately reads as plain unavailability: the provider's
 * billing state is not the caller's business.
 */
const FAILURE_RESPONSES: Record<
  AsrRelayFailureReason,
  { status: number; code: string; message: string }
> = {
  rejected_audio: {
    status: 400,
    code: 'asr_rejected_audio',
    message: 'The transcription service could not process this recording.',
  },
  too_large: {
    status: 413,
    code: 'audio_too_large',
    // Distinct from the local parser's message: a body that reached upstream
    // already passed our own 25 MB cap, so the provider's bound must be lower.
    message: 'The recording exceeds the transcription service size limit.',
  },
  no_allocation: {
    status: 503,
    code: 'asr_unavailable',
    message: 'Hosted transcription is not available.',
  },
  rate_limited: {
    status: 429,
    code: 'rate_limited',
    message: 'Too many transcription requests. Please retry shortly.',
  },
  unavailable: { status: 502, code: 'asr_failed', message: 'Transcription failed.' },
}

/*
 * Audio in, text out, nothing stored: the consultation, if the doctor submits
 * one, arrives later through `POST /api/consultations` with
 * `source: 'asr_hosted'`. Pre-flight rejections write no audit row because the
 * upstream call was never attempted; once `transcribeWithIlmu` is called,
 * exactly one of the two relay events is written before any response leaves
 * (every post-attempt failure inside the adapter is an `IlmuRelayError`), so
 * no unaudited relay outcome can be observed by a client.
 */
asrRouter.post(
  '/transcriptions',
  requireIlmuConfigured,
  acquireRelaySlot,
  parseAudioBody,
  async (req, res) => {
    const actor = doctorId(req)

    const contentType = req.get('content-type')
    if (!contentType || !req.is('audio/*')) {
      throw new HttpError(415, 'unsupported_media_type', 'An audio/* content type is required.')
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'invalid_body', 'A non-empty audio body is required.')
    }

    const { model } = getAsrDescriptor()
    const startedAt = performance.now()

    try {
      const result = await transcribeWithIlmu(req.body, contentType)

      // Before the response and unguarded: a failed audit write fails the
      // request, so a success the trail did not record is never observable.
      await recordAuditEvent({
        action: 'asr.hosted_relayed',
        actorId: actor,
        metadata: { durationSeconds: result.durationSeconds, model },
      })

      logger.info('hosted asr relayed', {
        actorId: actor,
        outcome: 'ok',
        durationMs: Math.round(performance.now() - startedAt),
        model,
        status: 200,
      })

      res.json(result)
    } catch (error) {
      if (!(error instanceof IlmuRelayError)) throw error

      const failure = FAILURE_RESPONSES[error.reason]

      await recordAuditEvent({
        action: 'asr.hosted_relay_failed',
        actorId: actor,
        metadata: { reason: error.reason },
      })

      logger.warn('hosted asr relay failed', {
        actorId: actor,
        outcome: 'error',
        durationMs: Math.round(performance.now() - startedAt),
        model,
        status: failure.status,
      })

      throw new HttpError(failure.status, failure.code, failure.message)
    }
  },
)

/**
 * Feature gate for the ambient routes, mirroring `requireIlmuConfigured`: a
 * deployment without a Soniox key answers 503 rather than minting nothing and
 * failing later in the browser, where the doctor is holding an open microphone.
 */
function requireSonioxConfigured(_req: Request, _res: Response, next: NextFunction) {
  if (!env.SONIOX_API_KEY) {
    next(new HttpError(503, 'asr_unavailable', 'Ambient transcription is not available.'))
    return
  }
  next()
}

/**
 * Fixed responses per mint failure. `rejected` reads as plain unavailability
 * because it means our own account credential or region is wrong, which is a
 * deployment fault rather than the caller's business.
 */
const LIVE_FAILURE_RESPONSES: Record<
  LiveSessionFailureReason,
  { status: number; code: string; message: string }
> = {
  rejected: {
    status: 503,
    code: 'asr_unavailable',
    message: 'Ambient transcription is not available.',
  },
  rate_limited: {
    status: 429,
    code: 'rate_limited',
    message: 'Too many ambient session requests. Please retry shortly.',
  },
  unavailable: {
    status: 502,
    code: 'asr_failed',
    message: 'Ambient transcription could not start.',
  },
}

/*
 * What the capture surface needs before anything is minted: where the audio
 * would go, and in which languages.
 *
 * Split from the mint deliberately. The consent copy has to name the provider
 * and the region before the doctor decides, and a doctor who is only reading
 * the screen must not spend a key to see it. Nothing egresses here, so there is
 * no audit row: the read is of our own configuration.
 */
asrRouter.get('/live-sessions/config', requireSonioxConfigured, (req, res) => {
  doctorId(req)

  const body = LiveAsrConfigSchema.safeParse({
    provider: 'soniox',
    region: env.SONIOX_REGION,
    websocketUrl: sonioxHosts(env.SONIOX_REGION).websocket,
    config: liveSessionConfig(),
  })
  // A failure here is a configuration defect, not a caller error: the shared
  // schema refuses a socket address the browser would also refuse.
  if (!body.success) {
    throw new HttpError(500, 'internal_error', 'Ambient transcription is misconfigured.')
  }

  res.json(body.data)
})

/*
 * Mints one browser-usable credential for one ambient session (#268).
 *
 * **This route never receives audio.** The stream runs from the browser to the
 * provider, because a WebSocket cannot pass through the Vercel rewrite that
 * makes the session cookie first-party (#156) and a direct browser-to-Render
 * socket would lose it. What stays here is the policy: an authenticated
 * session, the consent the client asserts, a per-caller limiter, a key that
 * expires in a minute and caps the session it opens, a reference id the client
 * cannot choose, and an audit row written before the response.
 *
 * The audit contract is the relay's. Pre-flight rejections (401, 400, 429, and
 * the unconfigured 503) write no row because nothing was minted; once
 * `mintSonioxSession` is called, exactly one of the two events is written
 * before any response leaves, so no unaudited session key can be observed by a
 * client.
 */
asrRouter.post('/live-sessions', requireSonioxConfigured, async (req, res) => {
  const actor = doctorId(req)

  const parsed = LiveSessionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'Consent for this consultation is required.')
  }

  const { model, region } = getLiveAsrDescriptor()
  const startedAt = performance.now()

  try {
    const session = await mintSonioxSession()

    // Parsed before the audit row, like the draft-turns pass: a recorded
    // success must never be followed by a body the client cannot use.
    const body = LiveSessionSchema.safeParse({
      provider: 'soniox',
      region,
      websocketUrl: sonioxHosts(region).websocket,
      config: liveSessionConfig(),
      apiKey: session.apiKey,
      expiresAt: session.expiresAt,
    })
    if (!body.success) {
      throw new SonioxMintError('Minted session failed schema validation', 'unavailable')
    }

    // Before the response and unguarded: a failed audit write fails the
    // request, so a key the trail did not record is never observable.
    await recordAuditEvent({
      action: 'asr.live_session_minted',
      actorId: actor,
      metadata: {
        clientReferenceId: session.clientReferenceId,
        model,
        region,
        maxSessionSeconds: MAX_SESSION_DURATION_SECONDS,
        // What the client said, which is all the API can know: the gate is a
        // property of the frontend and this row records the assertion.
        consentAsserted: true,
      },
    })

    // The one response in this system that carries a credential. POST is not
    // cacheable without explicit freshness, so this is defence in depth.
    res.setHeader('Cache-Control', 'no-store')

    logger.info('live asr session minted', {
      actorId: actor,
      outcome: 'ok',
      durationMs: Math.round(performance.now() - startedAt),
      model,
      status: 200,
    })

    res.json(body.data)
  } catch (error) {
    if (!(error instanceof SonioxMintError)) throw error

    const failure = LIVE_FAILURE_RESPONSES[error.reason]

    await recordAuditEvent({
      action: 'asr.live_session_failed',
      actorId: actor,
      metadata: { reason: error.reason },
    })

    logger.warn('live asr session failed', {
      actorId: actor,
      outcome: 'error',
      durationMs: Math.round(performance.now() - startedAt),
      model,
      status: failure.status,
    })

    throw new HttpError(failure.status, failure.code, failure.message)
  }
})

/*
 * The labelling pass that follows a hosted relay (docs/trd.md §20.3): the
 * relay's flat prose comes back here as text, is de-identified, and the LLM
 * drafts Doctor / Patient turns that the client shows for review. Nothing is
 * stored, exactly like the relay above; the consultation, if submitted,
 * arrives later through `POST /api/consultations`.
 *
 * The audit contract is the relay's too. Pre-egress rejections (401, 400,
 * 429, and a `DeidentificationError`, which blocks the provider call before
 * it is made) write no row; once the LLM call is attempted, exactly one of
 * the two draft events is written before any response leaves.
 *
 * Failure detail is deliberately flat: every post-egress failure is one
 * generic 502, because on this path an error message can embed model output,
 * which is transcript-derived. The client's only move on any failure is the
 * same, falling back to the unlabelled prose it already holds.
 */
asrRouter.post('/draft-turns', async (req, res) => {
  const actor = doctorId(req)

  const parsed = DraftTurnsRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_body', 'A non-empty transcript text is required.')
  }

  const { model } = getLLMDescriptor()
  const startedAt = performance.now()

  try {
    const { text: content, vault, detected } = deidentify(parsed.data.text)
    const turns = await draftTurns(content)

    // Rehydrated per turn against the request-scoped vault, so the doctor
    // reviews the words that were actually said, not the pseudonym tokens.
    const rehydrated = turns.map((turn) => ({
      speaker: turn.speaker,
      text: vault.rehydrate(turn.text),
    }))

    // Re-parsed after rehydration because restoring an original span can push
    // a turn past the schema's character cap; failing here, before the audit
    // row, keeps `res.json` structurally unable to follow a recorded success
    // with an invalid body.
    const body = DraftTurnsResponseSchema.safeParse({ turns: rehydrated })
    if (!body.success) throw new DraftTurnsError('not_reconstructed')

    // Before the response and unguarded, like the relay's success row: a
    // labelling egress the trail did not record is never observable.
    await recordAuditEvent({
      action: 'asr.hosted_draft_labelled',
      actorId: actor,
      metadata: { turnCount: rehydrated.length, detected, model },
    })

    logger.info('hosted draft turns labelled', {
      actorId: actor,
      outcome: 'ok',
      durationMs: Math.round(performance.now() - startedAt),
      model,
      status: 200,
      count: rehydrated.length,
    })

    res.json(body.data)
  } catch (error) {
    if (error instanceof DraftTurnsError) {
      await recordAuditEvent({
        action: 'asr.hosted_draft_failed',
        actorId: actor,
        metadata: { reason: error.reason },
      })

      logger.warn('hosted draft turns failed', {
        actorId: actor,
        outcome: 'error',
        durationMs: Math.round(performance.now() - startedAt),
        model,
        status: 502,
      })

      throw new HttpError(502, 'draft_failed', 'Speaker labelling failed.')
    }

    if (error instanceof DeidentificationError) {
      logger.warn('hosted draft turns failed', {
        actorId: actor,
        outcome: 'error',
        durationMs: Math.round(performance.now() - startedAt),
        model,
        status: 500,
      })

      // Its own code, not `draft_failed`: the egress guard firing is the one
      // alarm the log taxonomy exists to surface, and `errorHandler` maps
      // `deid_failed` to `deidentification_error` rather than `model_error`.
      throw new HttpError(500, 'deid_failed', 'Speaker labelling failed.')
    }

    throw error
  }
})
