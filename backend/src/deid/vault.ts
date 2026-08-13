import type { TokenVault } from './types.js'

/**
 * Request-scoped token vault.
 *
 * Created once per analyse request alongside the tokenised text. **Never a
 * module-level singleton, never attached to a `Consultation` row, never
 * serialised, never logged.** It is discarded when the request handler returns
 * (docs/trd.md §9).
 *
 * The class holds no static state, so two concurrent requests cannot see each
 * other's entries — the property that makes "request-scoped" true rather than
 * merely intended.
 */
export class RequestTokenVault implements TokenVault {
  /** token -> original span */
  private readonly forward = new Map<string, string>()
  /** normalised original -> token, so a repeat maps to the token already minted */
  private readonly reverse = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  get entries(): ReadonlyMap<string, string> {
    return this.forward
  }

  /**
   * Returns the token for `value`, minting one on first sight. Matching is
   * case- and whitespace-insensitive so the model sees one consistent handle
   * per person across the whole transcript; the first spelling encountered is
   * what rehydration restores.
   */
  tokenFor(label: string, value: string): string {
    const key = `${label}:${value.toLowerCase().replace(/\s+/g, ' ').trim()}`
    const existing = this.reverse.get(key)
    if (existing) return existing

    const next = (this.counters.get(label) ?? 0) + 1
    this.counters.set(label, next)
    const token = `[${label}_${next}]`
    this.forward.set(token, value)
    this.reverse.set(key, token)
    return token
  }

  /**
   * Re-inserts original spans into model output before it reaches the doctor.
   * The model may echo a token back verbatim, so every string field on the
   * response path passes through here (docs/trd.md §9).
   */
  rehydrate(text: string): string {
    let out = text
    for (const [token, original] of this.forward) {
      out = out.split(token).join(original)
    }
    return out
  }
}
