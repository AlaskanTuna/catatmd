import type { Transcript } from '@shared/types'
import { detect } from './detectors.js'
import type { DeidentificationResult, Deidentified } from './types.js'
import { RequestTokenVault } from './vault.js'

/**
 * The only place in the codebase that mints the branded type. Deliberately not
 * exported — see the note in `types.ts`.
 */
function markDeidentified(value: string): Deidentified {
  return value as Deidentified
}

export { type DetectorLabel, detect, type Match } from './detectors.js'
export type { DeidentificationResult, Deidentified, TokenVault } from './types.js'
export { RequestTokenVault } from './vault.js'

/** Shape of an already-minted token, e.g. `[PATIENT_1]`. */
const TOKEN_PATTERN = /\[[A-Z]+_\d+\]/g

export class DeidentificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeidentificationError'
  }
}

/**
 * Replaces every detected identifier with a stable pseudonymous token.
 *
 * Fail-closed by contract: this throws rather than returning a partial result
 * if any detector step fails internally, because a caller that received partial
 * output could fall through to sending original text (docs/trd.md §9).
 *
 * `markDeidentified` is called here and nowhere else — this function is the
 * only place in the codebase that mints the branded type.
 */
export function deidentify(text: string, vault = new RequestTokenVault()): DeidentificationResult {
  let matches: ReturnType<typeof detect>
  try {
    matches = detect(text)
  } catch (cause) {
    throw new DeidentificationError(
      `De-identification failed; the LLM call must not proceed: ${
        cause instanceof Error ? cause.name : 'unknown error'
      }`,
    )
  }

  // Right to left, so each replacement leaves earlier offsets valid.
  let out = text
  for (const match of [...matches].reverse()) {
    const token = vault.tokenFor(match.label, match.value)
    out = out.slice(0, match.start) + token + out.slice(match.end)
  }

  const detected = [...new Set(matches.map((m) => m.label))].sort()
  return { text: markDeidentified(out), vault, detected }
}

/**
 * Serialises a transcript as speaker-labelled turns and de-identifies the whole
 * thing against **one** vault, so the same person carries the same token across
 * every turn rather than a new one per turn (docs/trd.md §9, §12).
 */
export function deidentifyTranscript(transcript: Transcript): DeidentificationResult {
  const serialised = transcript.turns
    .map((turn) => `${turn.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${turn.text}`)
    .join('\n')
  return deidentify(serialised)
}

/**
 * The egress guard (docs/trd.md §19 row 2).
 *
 * Re-runs detection on a payload that is *about* to leave the process and
 * throws if anything fires. Already-minted tokens are stripped first so the
 * guard inspects only what survived the gate.
 *
 * This is a second, independent check rather than a duplicate of the first: it
 * is what catches a `Deidentified` value minted outside `deid/` — the
 * enforcement gap docs/trd.md §5 records, where the type system guarantees the
 * *shape* of what reaches `LLMClient` but not its *provenance*.
 */
export function assertNoIdentifiers(content: Deidentified, operation: string): void {
  const withoutTokens = content.replace(TOKEN_PATTERN, ' ')
  const leaked = detect(withoutTokens)
  if (leaked.length === 0) return

  // Labels only. Never the matched values — an exception message is a log line
  // waiting to happen (docs/trd.md §4, §15; healthcare-phi-compliance).
  const labels = [...new Set(leaked.map((m) => m.label))].sort().join(', ')
  throw new DeidentificationError(
    `Egress blocked for operation "${operation}": payload still carries ${labels}`,
  )
}
