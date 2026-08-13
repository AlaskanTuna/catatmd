import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../lib/http-error.js'
import { errorHandler } from './error-handler.js'

function mockRes() {
  const res = {
    headersSent: false,
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  }
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>
    json: ReturnType<typeof vi.fn>
  }
}

describe('errorHandler', () => {
  it('passes an HttpError through with its status and code', () => {
    const res = mockRes()

    errorHandler(
      new HttpError(404, 'not_found', 'Consultation not found.'),
      {} as Request,
      res,
      vi.fn(),
    )

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'not_found', message: 'Consultation not found.' },
    })
  })

  it('collapses an unexpected error to a generic 500, discarding its message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = mockRes()
    const leaky = new Error(
      'Prisma failed at /home/app/src/db.ts:42 — transcript: patient reports chest pain',
    )

    errorHandler(leaky, {} as Request, res, vi.fn())

    expect(res.status).toHaveBeenCalledWith(500)

    const body = JSON.stringify(res.json.mock.calls.at(0))
    expect(body).toContain('An unexpected error occurred.')
    expect(body).not.toContain('chest pain')
    expect(body).not.toContain('/home/app')
    expect(body).not.toContain('Prisma')

    spy.mockRestore()
  })

  // Logging moved from `console.error` to `lib/logger.ts` in issue #15, so the
  // assertion now reads the log drain rather than the console. The intent is
  // unchanged: the class is recorded, the message never is.
  it('never writes the error message to the log', () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })

    errorHandler(
      new Error('transcript: patient reports chest pain'),
      {} as Request,
      mockRes(),
      vi.fn(),
    )

    spy.mockRestore()

    const logged = lines.join('')
    expect(logged).not.toContain('chest pain')
    expect(logged).toContain('"errorName":"Error"')
    expect(logged).toContain('"errorClass":"internal_error"')
  })

  it('classifies a de-identification failure distinctly from a model failure', () => {
    const lines: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })

    class DeidentificationError extends Error {
      override name = 'DeidentificationError'
    }
    class LLMResponseError extends Error {
      override name = 'LLMResponseError'
    }

    errorHandler(new DeidentificationError('x'), {} as Request, mockRes(), vi.fn())
    errorHandler(new LLMResponseError('y'), {} as Request, mockRes(), vi.fn())
    spy.mockRestore()

    expect(lines.join('')).toContain('"errorClass":"deidentification_error"')
    expect(lines.join('')).toContain('"errorClass":"model_error"')
  })

  it('delegates to express when headers are already sent', () => {
    const res = mockRes()
    res.headersSent = true
    const next = vi.fn() as unknown as NextFunction
    const err = new Error('boom')

    errorHandler(err, {} as Request, res, next)

    expect(next).toHaveBeenCalledWith(err)
    expect(res.status).not.toHaveBeenCalled()
  })
})
