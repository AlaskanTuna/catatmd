import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { logger, withRequestContext } from '../lib/logger.js'

/**
 * A client-supplied id is echoed only if it is short and alphanumeric. An
 * unvalidated header would let a caller write arbitrary text into the log
 * drain, which is both a log-injection vector and a way to place clinical text
 * into logs from outside the system.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Opaque identifiers are replaced with `:id` so a route reads as a low
 * cardinality pattern rather than a specific record. The consultation id is
 * still logged, but as an explicit `consultationId` field, which keeps it out
 * of any URL that might be indexed or scraped by a log tool
 * (healthcare-phi-compliance, "URL parameters").
 */
function normaliseRoute(path: string): string {
  return (path.split('?')[0] ?? path)
    .split('/')
    .map((segment) => (/^[A-Za-z0-9_-]{16,}$/.test(segment) ? ':id' : segment))
    .join('/')
}

/**
 * Assigns a request id, exposes it on the response, and records one line per
 * completed request (GitHub issue #15).
 *
 * The id is surfaced as the `x-request-id` response header rather than inside
 * the error envelope: the envelope is a contract the SPA parses
 * (`ErrorEnvelopeSchema` in `@shared/types`), while a correlation id is
 * transport metadata. Header placement also means every response carries it,
 * not just failures.
 *
 * Mounted first in `app.ts`, so no later middleware can log without a request
 * id in scope.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header('x-request-id')
  const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID()

  res.setHeader('x-request-id', requestId)

  const startedAt = performance.now()
  res.on('finish', () => {
    logger.info('request completed', {
      requestId,
      method: req.method,
      route: normaliseRoute(req.path),
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    })
  })

  withRequestContext(requestId, next)
}
