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

/**
 * Minting is **not** exported (docs/trd.md §19 row 1, closed 13/08/26).
 *
 * This function used to be exported, which meant any file could import it and
 * brand a raw string without detection ever running — the type system
 * guaranteed the *shape* of what reached `LLMClient` but not its *provenance*.
 * It now lives module-private to `deid/index.ts`, so that specific escape hatch
 * is a compile error rather than a convention.
 *
 * A deliberate `value as Deidentified` cast is still possible — TypeScript
 * cannot prevent that — which is why it is not the only control: the egress
 * guard in `deid/index.ts` re-scans every payload immediately before it leaves
 * the process, and a smuggled value fails there at runtime.
 */

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
