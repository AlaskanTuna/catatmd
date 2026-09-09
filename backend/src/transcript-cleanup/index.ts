import type { MishearProposal, Transcript } from '@shared/types'
import { z } from 'zod'
import { DeidentificationError, deidentifyTranscript, sliceDeidentified } from '../deid/index.js'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { applyEditPolicy, type CleanupEdit } from './policy.js'
import { TRANSCRIPT_CLEANUP_SYSTEM_PROMPT } from './prompt.js'

/**
 * The third accuracy layer: a constrained model pass over spans the recogniser
 * itself doubted (#309).
 *
 * Layer 1 primes the recogniser (`lib/asr/vocabulary.ts`), layer 2 is the
 * measured 11-entry confusable table (`redflags/mishears.ts`), and this is
 * layer 3, for the mishears neither can reach. docs/trd.md §20.10 records
 * "batuk" returning as "betul" on this provider, a pair no confusable table can
 * claim without raising a cough flag on every sentence agreeing with the doctor.
 *
 * **Ordering is the evidence, not a preference.** PMC13344086 measured
 * dictionary-then-LLM beating LLM-alone 64.9 against 36 percent CER reduction
 * on Korean-English clinical ASR, which is why layer 2 ships unconditionally and
 * this runs after it and may only add.
 *
 * **Off by default.** docs/trd.md §20.9: "the model pass earns its place only if
 * it finds correct corrections the table does not." `TRANSCRIPT_CLEANUP` gates
 * it and defaults to `off`; `evals/transcript-cleanup.ts` is what produces the
 * number that would justify turning it on.
 */

/**
 * What the model may say, and it is deliberately almost nothing.
 *
 * **Two strings and no position.** `turnIndex`, `start`, `end`, `id` and
 * `source` are all absent, so a response is structurally unable to assert where
 * an edit lands or to claim it came from the measured table. Positions are
 * resolved server-side in `policy.ts` by locating the text, which is also the
 * only approach that survives rehydration: `vault.rehydrate` changes string
 * length, so an offset computed in de-identified space describes a string that
 * no longer exists (`routes/asr.ts` re-parses after rehydration for exactly this
 * reason).
 *
 * Backend-local rather than shared, because it never crosses the HTTP boundary.
 * What reaches a client is `MishearProposalSchema`, built here from this.
 */
const MAX_EDITS_PER_CHUNK = 20

const CleanupResponseSchema = z.object({
  edits: z
    .array(
      z.object({
        original: z.string(),
        replacement: z.string(),
      }),
    )
    .max(MAX_EDITS_PER_CHUNK),
})

/**
 * How much de-identified text goes into one call.
 *
 * **Not measured, and larger than `draft_turns` on purpose.** That pass uses 600
 * because its output is a verbatim echo guarded by word-for-word reconstruction,
 * so length drove its failure rate. Nothing here echoes: the model returns a
 * short edit list, and a longer window is strictly better for the judgement it
 * is being asked to make, which is whether a word is plausible in context.
 * 1,500 is a starting value chosen to give a few turns of surrounding
 * conversation while keeping the fan-out small.
 */
const CHUNK_CHARS = 1_500

/**
 * The most transcript this pass will read, and therefore the fan-out ceiling.
 *
 * **Without it the bound is the schema's, which is far too generous here.**
 * `TranscriptSchema` allows 600 turns of 4,000 characters, so a stored
 * transcript can reach millions of characters and slice into over a thousand
 * chunks, each a provider call with a 60 s timeout and a retry behind it.
 * `MAX_CONCURRENT_CHUNKS` bounds how many run at once, not how many run, and
 * the limiter allows twenty such requests a minute per caller (OWASP LLM10).
 *
 * 30,000 matches `MAX_DRAFT_TEXT_CHARACTERS`, the equivalent bound on the
 * labelling pass, which is comfortably above the longest consultation measured
 * in development (about 3,000 words). Past it the pass declines rather than
 * truncating, because a silently half-read transcript would report `ok` while
 * having skipped the end of the consultation, which is where a plan usually is.
 */
const MAX_CLEANUP_CHARACTERS = 30_000

/** The same fan-out bound `draft-turns` carries, for the same OWASP LLM10 reason. */
const MAX_CONCURRENT_CHUNKS = 4

/**
 * A minted pseudonym, as it appears before rehydration.
 *
 * Not global: `RegExp.prototype.test` on a `/g` pattern carries `lastIndex`
 * between calls and would skip every other match.
 */
const VAULT_TOKEN = /\[[A-Z]+_\d+\]/

export type CleanupOutcome = {
  /** `failed` means the provider or its schema did; the caller still serves layer 2. */
  status: 'ok' | 'failed'
  /**
   * Why it failed, for the audit row. Closed, because anything thrown on this
   * path can carry a fragment of the consultation, and absent on success.
   * `deid_failed` is not one of these: that error leaves this module unwrapped
   * so the route can name it as the alarm it is.
   */
  reason?: 'llm_failed' | 'too_long'
  proposals: MishearProposal[]
  dropped: number
}

/**
 * Proposes model corrections, or reports that it could not.
 *
 * **This never throws for a provider failure.** #308's deterministic proposals
 * ship unconditionally, and layer 3 falling over must not take layer 2 off the
 * doctor's screen. `DeidentificationError` is the one exception and passes
 * through untouched, because the egress guard firing is an alarm rather than a
 * correction outcome and must not be softened into one.
 */
export async function proposeModelCorrections(transcript: Transcript): Promise<CleanupOutcome> {
  /*
   * **No uncertain range means no egress at all.** The gate is checked before
   * the transcript is de-identified rather than after the edits come back, so a
   * consultation with nothing to correct never leaves the API in the first
   * place. In practice that is every typed, pasted, uploaded and relayed
   * transcript, because only ambient capture measures a per-token confidence.
   *
   * **The ranges are client-asserted, exactly like `source` and
   * `labelsReviewed`.** `TranscriptSchema` carries `uncertain` and `PATCH
   * /api/consultations/:id` accepts a whole transcript on a draft, so a client
   * can write them. What this gate guarantees is that no ranges means no
   * egress; it does not guarantee that a range came from a recogniser. That is
   * the same posture the rest of the transcript contract takes, and no safety
   * control rests on it alone: the suppression check in `policy.ts` is what
   * protects the words that matter, and it asks the engine rather than the
   * client.
   */
  const hasUncertainty = transcript.turns.some((turn) => (turn.uncertain?.length ?? 0) > 0)
  if (!hasUncertainty) return { status: 'ok', proposals: [], dropped: 0 }

  /*
   * Declines rather than truncating. A half-read transcript would report `ok`
   * having skipped the end of the consultation, which is where a plan usually
   * is, and `failed` is the honest word for a pass that did not run.
   */
  const totalCharacters = transcript.turns.reduce((sum, turn) => sum + turn.text.length, 0)
  if (totalCharacters > MAX_CLEANUP_CHARACTERS) {
    return { status: 'failed', reason: 'too_long', proposals: [], dropped: 0 }
  }

  const { text, vault } = deidentifyTranscript(transcript)
  // After the gate, never before. Detection is context-sensitive, so chunking
  // first would let an identifier straddling a boundary through; `deid/index.ts`
  // states the rule and `sliceDeidentified` is the only sanctioned way to cut
  // branded text.
  const chunks = sliceDeidentified(text, CHUNK_CHARS)

  let failed = false
  const perChunk = await mapWithLimit(chunks, MAX_CONCURRENT_CHUNKS, async (chunk) => {
    try {
      return await cleanChunk(chunk)
    } catch (cause) {
      if (cause instanceof DeidentificationError) throw cause
      failed = true
      return []
    }
  })

  /*
   * **Any edit naming a vault token is dropped before rehydration, not after.**
   * The policy's character class rejects brackets, but it never sees them:
   * rehydration runs first, so a model echoing `[PATIENT_1]` as a replacement
   * would have it expanded to the real name, and two letter-only words then pass
   * both the character class and the word-delta bound. That is not an egress
   * leak, since the value came from this consultation's own vault and returns to
   * its owner, but it would let the model move an identifier into a span the
   * recogniser doubted and offer it to the doctor as a correction. Checked on
   * the pre-rehydration string, which is the only point the token is still
   * visible as a token.
   */
  const returned = perChunk.flat()
  const admissible = returned.filter(
    (edit) => !VAULT_TOKEN.test(edit.original) && !VAULT_TOKEN.test(edit.replacement),
  )
  const edits: CleanupEdit[] = admissible.map((edit) => ({
    original: vault.rehydrate(edit.original),
    replacement: vault.rehydrate(edit.replacement),
  }))

  const { proposals, dropped } = applyEditPolicy(edits, transcript)
  return {
    status: failed ? 'failed' : 'ok',
    ...(failed ? { reason: 'llm_failed' as const } : {}),
    proposals,
    // Edits refused for naming a token are drops like any other, so the audit
    // row's rate stays a count of everything the model offered and lost.
    dropped: dropped + (returned.length - admissible.length),
  }
}

async function cleanChunk(content: Deidentified): Promise<CleanupEdit[]> {
  const response = await getLLMClient().generate({
    operation: 'transcript_cleanup',
    system: TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
    content,
    schema: CleanupResponseSchema,
    schemaName: 'transcript_cleanup',
    temperature: 0,
  })
  return [...response.edits]
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await run(item)
    }
  })
  await Promise.all(workers)
  return results
}
