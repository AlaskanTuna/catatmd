import { type DraftTurn, DraftTurnsResponseSchema } from '@shared/types'
import type { DraftTurnsFailureReason } from '../audit/index.js'
import { DeidentificationError } from '../deid/index.js'
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

export async function draftTurns(content: Deidentified): Promise<DraftTurn[]> {
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
      // The output is a verbatim echo of the input plus labels, so it is
      // structurally bounded by the 50k-char request cap; the adapter's 8192
      // default would clip exactly the long transcripts this pass is for.
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
