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
const TOKEN_PLACEHOLDER = '\0'

function detectOutsideTokens(content: string): ReturnType<typeof detect> {
  let projected = ''
  let cursor = 0
  const shifts: { projectedAt: number; removed: number }[] = []

  for (const token of content.matchAll(TOKEN_PATTERN)) {
    projected += content.slice(cursor, token.index)
    shifts.push({ projectedAt: projected.length, removed: token[0].length - 1 })
    projected += TOKEN_PLACEHOLDER
    cursor = token.index + token[0].length
  }
  projected += content.slice(cursor)

  const restoreOffset = (offset: number) =>
    offset +
    shifts.reduce((removed, shift) => removed + (shift.projectedAt < offset ? shift.removed : 0), 0)

  return detect(projected).map((match) => {
    const start = restoreOffset(match.start)
    const end = restoreOffset(match.end)
    return { ...match, start, end, value: content.slice(start, end) }
  })
}

export const DEIDENTIFICATION_FAILURE_STAGES = ['detector_failure', 'egress_block'] as const
export type DeidentificationFailureStage = (typeof DEIDENTIFICATION_FAILURE_STAGES)[number]

export const DEIDENTIFICATION_PAYLOAD_ORIGINS = [
  'input',
  'digest',
  'system_prompt',
  'history',
  'current_message',
  'egress_system',
  'egress_turn',
  'egress_content',
  'egress_input',
] as const
export type DeidentificationPayloadOrigin = (typeof DEIDENTIFICATION_PAYLOAD_ORIGINS)[number]

export class DeidentificationError extends Error {
  constructor(
    message: string,
    readonly failureStage: DeidentificationFailureStage,
    readonly payloadOrigin: DeidentificationPayloadOrigin,
  ) {
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
export function deidentify(
  text: string,
  vault = new RequestTokenVault(),
  payloadOrigin: DeidentificationPayloadOrigin = 'input',
): DeidentificationResult {
  let out = text
  const detected = new Set<string>()

  for (;;) {
    let matches: ReturnType<typeof detect>
    try {
      matches = detectOutsideTokens(out)
    } catch (cause) {
      throw new DeidentificationError(
        `De-identification failed; the LLM call must not proceed: ${
          cause instanceof Error ? cause.name : 'unknown error'
        }`,
        'detector_failure',
        payloadOrigin,
      )
    }

    if (matches.length === 0) break

    /*
     * Replacing one identifier can shorten the surrounding text enough to
     * bring a context cue inside another detector's window. Each pass uses the
     * same token-stripped projection as the final egress guard and maps matches
     * back to the original offsets. Re-scan until no matches remain so the
     * value earns its brand at the fixed point the guard expects.
     */
    for (const match of [...matches].reverse()) {
      detected.add(match.label)
      const token = vault.tokenFor(match.label, match.value)
      out = out.slice(0, match.start) + token + out.slice(match.end)
    }
  }

  return { text: markDeidentified(out), vault, detected: [...detected].sort() }
}

/**
 * Serialises a transcript as speaker-labelled turns and de-identifies the whole
 * thing against **one** vault, so the same person carries the same token across
 * every turn rather than a new one per turn (docs/trd.md §9, §12).
 */
export function deidentifyTranscript(transcript: Transcript): DeidentificationResult {
  return deidentify(serialiseTranscript(transcript))
}

/**
 * Exported because the evidence check (§21.4) must match spans against text in
 * **exactly** this format. Two copies of a format that has to stay
 * byte-identical is a drift bug waiting to happen, so there is one.
 */
export function serialiseTranscript(transcript: Transcript): string {
  return transcript.turns
    .map((turn) => `${turn.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${turn.text}`)
    .join('\n')
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
/**
 * Splits an already-gated value into whitespace-bounded pieces that are still
 * `Deidentified`.
 *
 * **It lives here because this is the module that owns the brand.** The caller
 * that needs it, the turn-labelling pass, cannot slice for itself: rebranding a
 * substring anywhere else is the `as Deidentified` cast that
 * `no-stray-brand-casts.test.ts` fails the build on, and rightly so.
 *
 * **Slicing after the gate rather than chunking before it is the whole point.**
 * Detection is context-sensitive: `Ahmad Ismail` is one PATIENT span only while
 * the two words are adjacent, so de-identifying chunk by chunk would let any
 * identifier straddling a boundary through. Running `deidentify` once over the
 * whole text and cutting the result keeps detection at full context, and every
 * piece inherits a guarantee the whole already earned.
 *
 * Cuts fall on whitespace, never inside a word, so a vault token cannot be
 * split into a `[PATIENT` and a `_1]` that no longer reads as one.
 *
 * The safety net is unchanged and per piece: each one goes to `LLMClient`
 * separately, so `assertNoIdentifiers` runs on each rather than once on the
 * whole, which makes this strictly more checked than the unsliced path.
 */
export function sliceDeidentified(content: Deidentified, maxChars: number): Deidentified[] {
  if (content.length <= maxChars) return [content]

  const pieces: Deidentified[] = []
  const words = content.split(/(\s+)/)
  let current = ''
  for (const part of words) {
    // A single word longer than the budget still goes out whole: cutting it
    // would break the alignment the caller reconstructs against.
    if (current !== '' && current.length + part.length > maxChars && part.trim() !== '') {
      pieces.push(markDeidentified(current.trimEnd()))
      current = ''
    }
    if (current === '' && part.trim() === '') continue
    current += part
  }
  if (current.trim() !== '') pieces.push(markDeidentified(current.trimEnd()))
  return pieces
}

export function assertNoIdentifiers(
  content: Deidentified,
  operation: string,
  payloadOrigin: DeidentificationPayloadOrigin = 'egress_content',
): void {
  const leaked = detectOutsideTokens(content)
  if (leaked.length === 0) return

  // Labels only. Never the matched values — an exception message is a log line
  // waiting to happen (docs/trd.md §4, §15; healthcare-phi-compliance).
  const labels = [...new Set(leaked.map((m) => m.label))].sort().join(', ')
  throw new DeidentificationError(
    `Egress blocked for operation "${operation}": payload still carries ${labels}`,
    'egress_block',
    payloadOrigin,
  )
}
