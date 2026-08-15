import { CopilotRequestSchema } from '@shared/types'
import { Router } from 'express'
import { runCopilotTurn } from '../copilot/index.js'
import { DeidentificationError } from '../deid/index.js'
import { assertOwnedConsultation } from '../lib/authz.js'
import { LLMResponseError } from '../lib/llm/index.js'
import { logger } from '../lib/logger.js'
import { copilotRateLimit } from '../middleware/rate-limit.js'
import { doctorId, toDetailWithApprover } from './consultations.js'

export const copilotRouter = Router({ mergeParams: true })

/**
 * `POST /api/consultations/:id/copilot` (GitHub issue #169).
 *
 * Streams one CatatAI turn as server-sent events. It is the only streaming
 * route in the API, and the only one whose response is not a validated closed
 * schema; `LLMClient.stream` documents why, and what stands in for it.
 *
 * **Why POST rather than the `EventSource` shape.** `EventSource` can only
 * issue a GET, which would put the doctor's question in a query string, and a
 * query string is the one part of a request that lands in access logs and proxy
 * logs by default. `AGENTS.md` forbids logging note or transcript content, and
 * a copilot question is both. The client reads the stream with `fetch` instead.
 */
copilotRouter.post('/', copilotRateLimit, async (req, res) => {
  const parsed = CopilotRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'invalid_request', message: 'Message is required.' },
    })
    return
  }

  // Ownership resolves before a single byte is written, so a 404 on someone
  // else's consultation is an ordinary JSON error rather than an error event
  // inside a 200 stream (`assertOwnedConsultation`: 404, never 403).
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const row = await assertOwnedConsultation(id ?? '', doctorId(req))
  const consultation = await toDetailWithApprover(row)

  res.status(200)
  res.setHeader('content-type', 'text/event-stream')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('connection', 'keep-alive')
  // Render proxies buffer by default, which holds the whole answer until the
  // turn completes and makes streaming pointless in production while looking
  // perfect locally.
  res.setHeader('x-accel-buffering', 'no')
  res.flushHeaders()

  /*
   * The doctor closing the panel must stop the provider call, not just stop
   * anyone listening to it. Without this the request runs to completion and is
   * billed in full for an answer nobody will read.
   */
  const abort = new AbortController()
  res.on('close', () => abort.abort())

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  try {
    for await (const chunk of runCopilotTurn({
      consultation,
      message: parsed.data.message,
      history: parsed.data.history,
      signal: abort.signal,
    })) {
      if (res.writableEnded) break
      send(chunk)
    }
    send({ type: 'done' })
  } catch (cause) {
    if (abort.signal.aborted) return

    /*
     * The stream is already a 200 with headers flushed, so a failure here
     * cannot become an HTTP status and has to travel as an event. The message
     * is chosen from the error's class rather than forwarded: `errorHandler`
     * never reads `err.message` for exactly this reason, and a schema failure
     * from the provider can embed model output.
     */
    const known =
      cause instanceof DeidentificationError
        ? 'The consultation could not be de-identified, so CatatAI was not called.'
        : cause instanceof LLMResponseError
          ? 'CatatAI could not complete that answer. Try rephrasing.'
          : 'Something went wrong reaching CatatAI.'

    logger.warn('copilot turn failed', {
      consultationId: consultation.id,
      errorClass:
        cause instanceof DeidentificationError
          ? 'deidentification_error'
          : cause instanceof LLMResponseError
            ? 'model_error'
            : 'internal_error',
      errorName: cause instanceof Error ? cause.name : 'Unknown',
    })
    send({ type: 'error', message: known })
  } finally {
    if (!res.writableEnded) res.end()
  }
})
