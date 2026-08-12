/**
 * The PHI trust boundary, enforced by the type system.
 *
 * `Deidentified` is a branded string that only `backend/src/deid/` can mint.
 * `LLMClient` accepts nothing else, so "raw transcript text reached a provider"
 * becomes a compile error rather than a code-review question.
 *
 * Do not export the brand, do not cast into this type, and do not add an
 * escape hatch. If you find yourself wanting one, the call belongs behind the
 * gate instead.
 */

declare const brand: unique symbol

export type Deidentified = string & { readonly [brand]: 'deidentified' }

/** Only `deid/` may call this. */
export function markDeidentified(value: string): Deidentified {
  return value as Deidentified
}

/**
 * Maps pseudonymous tokens back to the original spans. Request-scoped and
 * never persisted — it exists only for the lifetime of one analysis.
 */
export interface TokenVault {
  /** e.g. "[PATIENT_1]" -> "Ahmad bin Ismail" */
  readonly entries: ReadonlyMap<string, string>
  /** Re-inserts original spans into model output before it reaches the doctor. */
  rehydrate(text: string): string
}

export interface DeidentificationResult {
  readonly text: Deidentified
  readonly vault: TokenVault
  /** Detector labels that fired, for the audit log. Never contains the values. */
  readonly detected: readonly string[]
}
