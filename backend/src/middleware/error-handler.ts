import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../lib/http-error.js'

/**
 * Terminal error handler. Two rules, both from issue #14's acceptance criteria:
 *
 *  1. Only an `HttpError` carries its message to the caller. Every other throw
 *     collapses to a generic 500, so a Prisma message, a stack frame, a file
 *     path, or a fragment of transcript embedded in an exception cannot reach
 *     the client.
 *  2. Nothing about the error is logged beyond its type. Transcript bodies and
 *     note contents routinely appear inside thrown values on this codepath;
 *     logging `err` would put clinical text in Render's log drain (AGENTS.md).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }

  console.error(
    `Unhandled error: ${err instanceof Error ? err.name : typeof err} (message withheld — may contain clinical text)`,
  )

  res.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred.' },
  })
}
