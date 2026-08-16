import { type DraftTurn, DraftTurnsResponseSchema } from '@shared/types'
import type { DraftTurnsFailureReason } from '../audit/index.js'
import { DeidentificationError, sliceDeidentified } from '../deid/index.js'
import type { Deidentified } from '../deid/types.js'
import { getLLMClient } from '../lib/llm/index.js'
import { DRAFT_TURNS_SYSTEM_PROMPT } from './prompt.js'
import { ReconstructionError, reconstructTurns } from './reconstruction.js'

/**
 * Drafts Doctor / Patient labels for a hosted-ASR transcript (#189). The
 * local recording path never comes here: its labels are drafted on the device
 * (`frontend/src/audio/draft-turns.ts`), and this pass exists only because
 * hosted output is unpunctuated, unsegmented prose that the on-device
 * heuristic structurally cannot split.
 *
 * The model is allowed to contribute exactly two things, turn boundaries and
 * speaker labels; `reconstructTurns` re-slices every turn's text from the
 * input, so relabelled speech is possible but rewritten speech is not. That
 * matters clinically, not just stylistically: a paraphrase that drops a
 * negation would flow into the red-flag engine as if the patient had said it.
 */

/** Message text is static per reason; it must never embed model output. */
export class DraftTurnsError extends Error {
  constructor(readonly reason: DraftTurnsFailureReason) {
    super(`Draft turn labelling failed: ${reason}`)
    this.name = 'DraftTurnsError'
  }
}

/**
 * How much de-identified text goes into one labelling call.
 *
 * The pass is a verbatim echo guarded by word-for-word reconstruction, so a
 * single drifted word discards every label in the call. That makes the failure
 * rate a function of length, and measured against production it is not a slow
 * curve: 180 characters labelled cleanly, 653 labelled cleanly in 19.5 s, and
 * 1,335 returned `draft_failed`. A real consultation is several thousand, so
 * the unchunked pass failed on exactly the input it exists for.
 *
 * 600 sits inside the range that was reliably passing rather than at the edge
 * of it. Chunks run concurrently, so wall-clock stays near one call rather
 * than multiplying, and a chunk that does fail now costs its own labels
 * instead of the transcript's.
 */
const CHUNK_CHARS = 600

/**
 * Adjacent turns from different chunks that share a speaker are one turn.
 *
 * A chunk boundary is arbitrary, so a doctor sentence split across two calls
 * comes back as two same-speaker turns. Merging keeps the review list showing
 * the speaker changes the doctor is there to check, rather than the places the
 * text happened to be cut.
 */
function mergeAdjacent(turns: readonly DraftTurn[]): DraftTurn[] {
  const merged: DraftTurn[] = []
  for (const turn of turns) {
    const last = merged.at(-1)
    if (last && last.speaker === turn.speaker) last.text = `${last.text} ${turn.text}`
    else merged.push({ ...turn })
  }
  return merged
}

export async function draftTurns(content: Deidentified): Promise<DraftTurn[]> {
  const chunks = sliceDeidentified(content, CHUNK_CHARS)

  /*
   * Concurrent, because the bound that matters is the caller's: the client
   * gives this pass 150 s and the adapter allows 60 s plus one retry, so
   * sequential chunks would blow through both on any real consultation.
   *
   * A rejected chunk keeps its text and loses only its labels, which is the
   * point of chunking at all. The whole pass still fails if *every* chunk
   * fails, so a broken model or a blocked egress is never dressed up as a
   * successful draft.
   */
  /*
   * A rejected chunk fails the whole pass rather than being papered over.
   *
   * The tempting alternative was to keep the other chunks' labels and give the
   * rejected one its neighbour's speaker. That fabricates attribution: up to
   * `CHUNK_CHARS` of patient speech is presented as the doctor's, nothing in
   * the response marks it as invented, and it flows into the note and the
   * red-flag engine that way. Doctor review does not redeem it, because what
   * is being reviewed is an undisclosed guess.
   *
   * Failing is safe here precisely because the client's fallback is now a real
   * one: it drafts labels on the device from the same prose and says on screen
   * that they are guesses. An honest local guess beats a server guess wearing
   * the model's authority.
   */
  const drafted = await mapWithLimit(chunks, MAX_CONCURRENT_CHUNKS, draftChunk)

  return mergeAdjacent(drafted.flat())
}

/**
 * The fan-out bound.
 *
 * `Promise.all` over the chunks was unbounded, and the request cap is 30,000
 * characters (`MAX_DRAFT_TEXT_CHARACTERS`), so one request could open 50
 * concurrent provider calls where it previously opened one, and the 5/min
 * limiter would let a single caller hold hundreds in flight. That is the
 * unbounded-consumption shape `MAX_CONCURRENT_RELAYS` already guards on the
 * audio route (OWASP LLM10).
 *
 * Four keeps a consultation-length transcript inside roughly two waves, so the
 * latency win survives, while the worst case stays a number the provider quota
 * and the instance can carry.
 */
const MAX_CONCURRENT_CHUNKS = 4

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

async function draftChunk(content: Deidentified): Promise<DraftTurn[]> {
  const client = getLLMClient()

  let turns: readonly DraftTurn[]
  try {
    const response = await client.generate({
      operation: 'draft_turns',
      system: DRAFT_TURNS_SYSTEM_PROMPT,
      content,
      schema: DraftTurnsResponseSchema,
      schemaName: 'draft_turns',
      temperature: 0,
      // The output is a verbatim echo of one chunk plus labels, so it is
      // structurally bounded by `CHUNK_CHARS` and sits far inside this ceiling.
      // The ceiling stays because the adapter's 8192 default is the wrong
      // shape of bound for an echo, and a clipped echo fails reconstruction
      // rather than degrading.
      maxTokens: 16_384,
    })
    turns = response.turns
  } catch (cause) {
    // DeidentificationError passes through untouched: the egress guard fired
    // before any provider call, and the route must not audit it as one.
    if (cause instanceof DeidentificationError) throw cause
    throw new DraftTurnsError('llm_failed')
  }

  try {
    return reconstructTurns(turns, content)
  } catch (cause) {
    if (cause instanceof ReconstructionError) throw new DraftTurnsError('not_reconstructed')
    throw cause
  }
}
