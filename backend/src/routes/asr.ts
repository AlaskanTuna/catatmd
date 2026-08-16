import { DraftTurnsRequestSchema, DraftTurnsResponseSchema } from '@shared/types'
import express, { type NextFunction, type Request, type Response, Router } from 'express'
import { type AsrRelayFailureReason, recordAuditEvent } from '../audit/index.js'
import { env } from '../config/env.js'
import { DeidentificationError, deidentify } from '../deid/index.js'
import { DraftTurnsError, draftTurns } from '../draft-turns/index.js'
import { getAsrDescriptor, IlmuRelayError, transcribeWithIlmu } from '../lib/asr/ilmu.js'
import { HttpError } from '../lib/http-error.js'
import { getLLMDescriptor } from '../lib/llm/index.js'
import { logger } from '../lib/logger.js'

export const asrRouter = Router()

/** `req.doctorId` is set by `requireSession`, which guards every route here. */
function doctorId(req: { doctorId?: string }): string {
  if (!req.doctorId) throw new HttpError(401, 'unauthenticated', 'Authentication required.')
  return req.doctorId
}

/**
 * 25 MB because that is the provider's own request cap: a body it would reject
 * anyway is refused before it is buffered. `inflate: false` keeps the cap
 * honest: audio is already compressed, and an inflated `Content-Encoding`
 * body would let a tiny request force a 25 MB allocation.
 */
const rawAudio = express.raw({ type: 'audio/*', limit: '25mb', inflate: false })

/**
 * A process-wide bound on live audio buffers, which the per-caller limiter
 * cannot give: `hostedAsrRateLimit` counts requests per `clientKey` per
 * minute, so N callers could otherwise hold N x 5 x 25 MB at once on Render's
 * 512 MB instance. Two concurrent relays keeps the worst case (body plus the
 * Blob snapshot, per request) comfortably inside it; the third caller gets a
 * clean 503 before any body is buffered, which beats an OOM that takes the
 * clinical routes down with it.
 */
const MAX_CONCURRENT_RELAYS = 2
let relaysInFlight = 0

function acquireRelaySlot(_req: Request, res: Response, next: NextFunction) {
  if (relaysInFlight >= MAX_CONCURRENT_RELAYS) {
    next(new HttpError(503, 'asr_unavailable', 'Hosted transcription is busy. Retry shortly.'))
    return
  }
  relaysInFlight += 1
  // 'close' fires once the response finishes or the connection drops, so the
  // slot is released on every exit path, including a client abort mid-upload.
  res.once('close', () => {
    relaysInFlight -= 1
  })
  next()
}

/**
 * Wraps the raw parser so an oversized body maps onto the error envelope.
 * `errorHandler` has no body-parser branch, so unwrapped, `entity.too.large`
 * would surface as a generic 500 rather than a 413.
 */
function parseAudioBody(req: Request, res: Response, next: NextFunction) {
  rawAudio(req, res, (error?: unknown) => {
    const parserErrorType =
      typeof error === 'object' && error !== null && 'type' in error
        ? (error as { type: unknown }).type
        : undefined
    if (parserErrorType === 'entity.too.large') {
      next(new HttpError(413, 'audio_too_large', 'The recording exceeds the 25 MB limit.'))
      return
    }
    if (parserErrorType === 'encoding.unsupported') {
      next(
        new HttpError(
          415,
          'unsupported_media_type',
          'Compressed request bodies are not supported.',
        ),
      )
      return
    }
    if (error) {
      next(error)
      return
    }
    next()
  })
}

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
