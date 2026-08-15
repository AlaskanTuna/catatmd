import { CopilotProposalSchema } from '@shared/types'
import { z } from 'zod'
import type { StreamTool } from '../lib/llm/types.js'

/**
 * The copilot's tools (GitHub issue #169).
 *
 * **Every tool here is a proposal, and none of them writes.** The model has no
 * path to the database at all: a tool call produces a `CopilotProposal`, the
 * proposal is rendered in the chat as a card, and the doctor's click is what
 * sends it to the apply route. That is not a UI convention layered over a
 * capable agent, it is the only thing the agent can do.
 *
 * Shaping it this way rather than as "call the tool, then ask permission"
 * matters because the two fail differently. An agent that can write and is
 * merely instructed to ask first writes when the instruction is missed; an
 * agent with no write tool cannot, whatever it is persuaded to attempt. The
 * transcript is untrusted input (`.claude/rules/security.md`) and a copilot
 * reads all of it, so the difference is load-bearing rather than theoretical.
 *
 * **What is deliberately absent**, and must stay absent:
 *
 * - No tool approves a note. Sign-off is the doctor's explicit state
 *   transition and may never originate from a model (`AGENTS.md`). There is no
 *   permission dialog that would make one acceptable.
 * - No tool removes, downgrades or hides a red flag. Dispositions record a
 *   decision *about* a flag and leave it on the record; `mergeRedFlags` stays
 *   a pure concat regardless of what is set here.
 * - No tool writes the justification for a dismissal. The model may propose
 *   the state; the doctor types the reason on `CopilotApplyRequest`.
 * - No tool reads anything the digest does not already contain. A read tool
 *   would be a second, unaudited route to consultation content, and the
 *   digest is rebuilt per turn anyway, so it would buy nothing.
 */

/**
 * Argument schemas, derived from the shared proposal union so the two cannot
 * drift. `tool` is stripped because the provider carries the name separately;
 * it is put back when the proposal is assembled.
 */
const ARGUMENTS = {
  edit_note_section: CopilotProposalSchema.options[0].omit({ tool: true }),
  set_red_flag_disposition: CopilotProposalSchema.options[1].omit({ tool: true }),
  set_gap_disposition: CopilotProposalSchema.options[2].omit({ tool: true }),
} as const

export type CopilotToolName = keyof typeof ARGUMENTS

const DESCRIPTIONS: Record<CopilotToolName, string> = {
  edit_note_section:
    'Propose replacing one section of the SOAP note with new text. The doctor sees the proposal and decides; nothing changes until they approve. Provide the full replacement text for that section, not a diff. Do not call this on an approved consultation.',
  set_red_flag_disposition:
    "Propose recording the doctor's decision about a red flag: acknowledged, dismissed, or not_applicable. This records a decision ABOUT the flag and never removes, downgrades or hides it; the flag stays on the record whatever is chosen. Use the bracketed flag id from the digest. Do NOT write a justification for a dismissal: the doctor types their own reason before approving.",
  set_gap_disposition:
    "Propose recording the doctor's decision about a piece of missing information: acknowledged, dismissed, or not_applicable. Use the bracketed gap id from the digest. Do NOT write a justification for a dismissal; the doctor supplies it.",
}

/** What the panel shows while the call is in flight, before prose starts. */
export const TOOL_LABELS: Record<CopilotToolName, string> = {
  edit_note_section: 'Drafting a note edit',
  set_red_flag_disposition: 'Preparing a red-flag decision',
  set_gap_disposition: 'Preparing a gap decision',
}

export const COPILOT_TOOLS: readonly StreamTool[] = (
  Object.keys(ARGUMENTS) as CopilotToolName[]
).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  parameters: z.toJSONSchema(ARGUMENTS[name], { target: 'draft-7' }) as Record<string, unknown>,
}))

/**
 * Turns a raw tool call into a validated proposal, or `null`.
 *
 * Returning `null` rather than throwing is deliberate: a model that invents a
 * tool name or malforms its arguments has produced one unusable suggestion,
 * and discarding it costs the doctor nothing. Failing the turn would throw
 * away the prose they are already reading for a fault they cannot act on.
 */
export function toProposal(name: string, args: unknown) {
  if (!(name in ARGUMENTS)) return null
  const parsed = CopilotProposalSchema.safeParse({
    ...(args as Record<string, unknown>),
    tool: name,
  })
  return parsed.success ? parsed.data : null
}
