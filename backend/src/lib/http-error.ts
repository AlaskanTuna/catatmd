/**
 * A failure that is safe to surface to a caller. Anything thrown that is *not*
 * an `HttpError` is treated by the error handler as unexpected and collapsed
 * into a generic 500, so an internal message can never leak by accident.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
