import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../lib/http-error.js'
import { type ErrorClass, logger } from '../lib/logger.js'

/**
 * Maps a failure onto the taxonomy in `lib/logger.ts` so each class is
 * distinguishable in a log line without anyone opening a payload
 * (GitHub issue #15).
 *
 * Classification reads the error's *type* and an `HttpError`'s developer
 * authored `code`. It never reads `message`, which on this codepath routinely
 * quotes a transcript.
 */
function classify(err: unknown): ErrorClass {
  if (err instanceof HttpError) {
    if (err.code === 'unauthenticated') return 'auth_error'
    if (err.code === 'invalid_body') return 'validation_error'
    if (err.code === 'analysis_failed') return 'model_error'
    return 'internal_error'
  }

  const name = err instanceof Error ? err.name : ''
  if (name === 'DeidentificationError') return 'deidentification_error'
  if (name === 'LLMResponseError') return 'model_error'
  if (name === 'ZodError') return 'schema_parse_error'
  return 'internal_error'
}

/**
 * Terminal error handler. Three rules, from issues #14 and #15:
 *
 *  1. Only an `HttpError` carries its message to the caller. Every other throw
 *     collapses to a generic 500, so a Prisma message, a stack frame, a file
 *     path, or a fragment of transcript embedded in an exception cannot reach
 *     the client.
 *  2. Nothing about the error is logged beyond its class and constructor name.
 *     `err.message`, `err.stack` and the request body are never touched, so
 *     there is no exception path that carries clinical text into the drain.
 *  3. The request id is on the response already (`requestContext` sets the
 *     header before any route runs), so a caller can quote it and an engineer
 *     can find the matching line without reading any content.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err)
    return
  }

  const errorClass = classify(err)
  const errorName = err instanceof Error ? err.name : typeof err

  if (err instanceof HttpError) {
    // Expected, client-visible failures. Logged at warn so they are greppable
    // without drowning genuine faults.
    logger.warn('request failed', { errorClass, errorName, status: err.status })
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }

  logger.error('unhandled error', { errorClass, errorName, status: 500 })

  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred.' },
  })
}
