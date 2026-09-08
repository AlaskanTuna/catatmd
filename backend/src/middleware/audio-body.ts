import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import { HttpError } from '../lib/http-error.js'

/**
 * The shared mechanics for a route that carries a recording.
 *
 * Extracted from `routes/asr.ts`, which worked these out first and paid for
 * them: the relay is where the 25 MB cap, the `inflate: false` reasoning, the
 * 413 mapping and the process-wide in-flight bound were all argued. Consultation
 * audio storage (#293) needs the same three, and a second copy would be a second
 * place for them to drift.
 */

/**
 * The largest recording accepted anywhere.
 *
 * 25 MB is ILMU's own request cap, which is why the relay chose it; the storage
 * routes match it so there is one number in the system rather than two, and a
 * recording that can be transcribed can always also be stored.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * `inflate: false` keeps the cap honest: audio is already compressed, and an
 * inflated `Content-Encoding` body would let a tiny request force a 25 MB
 * allocation.
 */
const rawAudio = express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES, inflate: false })

/**
 * Wraps the raw parser so an oversized body maps onto the error envelope.
 *
 * `errorHandler` has no body-parser branch, so unwrapped, `entity.too.large`
 * would surface as a generic 500 rather than a 413, and the caller could not
 * tell "too big" from "server broken".
 */
export function parseAudioBody(req: Request, res: Response, next: NextFunction) {
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
 * A process-wide bound on concurrent audio buffers, which a per-caller limiter
 * structurally cannot give.
 *
 * `express-rate-limit` counts requests per `clientKey` per minute, so N callers
 * can each be inside their own allowance while holding N buffers at once. On
 * Render's 512 MB instance a handful of 25 MB bodies is the whole heap, and the
 * failure mode is an OOM that takes the clinical routes down with it. A clean
 * 503 before any body is read is strictly better.
 *
 * A factory rather than one global counter, so each kind of audio traffic can be
 * bounded on its own terms and one cannot starve another.
 */
export function inFlightGate({
  limit,
  code,
  message,
}: {
  limit: number
  code: string
  message: string
}): RequestHandler {
  let inFlight = 0
  return (_req, res, next) => {
    if (inFlight >= limit) {
      next(new HttpError(503, code, message))
      return
    }
    inFlight += 1
    // 'close' fires once the response finishes or the connection drops, so the
    // slot is released on every exit path, including a client abort mid-upload.
    res.once('close', () => {
      inFlight -= 1
    })
    next()
  }
}
