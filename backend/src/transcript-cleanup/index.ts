import type { MishearProposal, RedFlag, Transcript } from '@shared/types'
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

/** The same fan-out bound `draft-turns` carries, for the same OWASP LLM10 reason. */
const MAX_CONCURRENT_CHUNKS = 4

export type CleanupOutcome = {
  /** `failed` means the provider or its schema did; the caller still serves layer 2. */
  status: 'ok' | 'failed'
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
export async function proposeModelCorrections(
  transcript: Transcript,
  ruleFlags: readonly RedFlag[],
): Promise<CleanupOutcome> {
  /*
   * **No uncertain span means no egress at all.** The gate is checked before the
   * transcript is de-identified rather than after the edits come back, so a
   * consultation with nothing to correct never leaves the API in the first
   * place. Every typed, pasted, uploaded and relayed transcript takes this
   * branch, because only ambient capture reports a per-token confidence.
   */
  const hasUncertainty = transcript.turns.some((turn) => (turn.uncertain?.length ?? 0) > 0)
  if (!hasUncertainty) return { status: 'ok', proposals: [], dropped: 0 }

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
   * Rehydrated before the policy sees them, so `original` is matched against the
   * transcript as stored rather than against its tokenised form. An edit whose
   * anchor spanned a pseudonym is not special-cased: it simply fails to locate,
   * and the policy drops it.
   */
  const edits: CleanupEdit[] = perChunk.flat().map((edit) => ({
    original: vault.rehydrate(edit.original),
    replacement: vault.rehydrate(edit.replacement),
  }))

  const { proposals, dropped } = applyEditPolicy(edits, transcript, ruleFlags)
  return { status: failed ? 'failed' : 'ok', proposals, dropped }
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
