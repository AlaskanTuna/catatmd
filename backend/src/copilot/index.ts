import type { ConsultationDetail, CopilotProposal, CopilotTurn } from '@shared/types'
import { deidentify } from '../deid/index.js'
import type { TokenVault } from '../deid/types.js'
import { RequestTokenVault } from '../deid/vault.js'
import { GUIDELINE_CORPUS } from '../guidelines/index.js'
import { getLLMClient } from '../lib/llm/index.js'
import type { StreamTurn } from '../lib/llm/types.js'
import { renderDigest } from './digest.js'
import { buildCopilotSystemPrompt } from './prompt.js'
import { COPILOT_TOOLS, type CopilotToolName, TOOL_LABELS, toProposal } from './tools.js'

/**
 * One turn of the CatatAI conversation (GitHub issue #169).
 *
 * **The de-identification boundary is the whole shape of this function.**
 * Three things reach the provider and every one of them is patient data: the
 * digest of the consultation, the doctor's typed message, and the prior turns
 * of the conversation. All three are tokenised through **one shared vault**,
 * which is what makes the tokens mean the same thing across the whole prompt:
 * a per-string vault would hand the model `[PATIENT_1]` in the digest and
 * `[PATIENT_1]` in the question referring to different people.
 *
 * Everything coming back is rehydrated through that same vault before it
 * reaches the doctor, including tool arguments. A proposed note edit that
 * still said `[PATIENT_1]` would write a token into the clinical record.
 */
export type CopilotChunk =
  | { type: 'tool'; name: string; label: string }
  | { type: 'token'; text: string }
  | { type: 'proposal'; proposal: CopilotProposal }

export async function* runCopilotTurn(options: {
  consultation: ConsultationDetail
  message: string
  history: readonly CopilotTurn[]
  signal?: AbortSignal
}): AsyncGenerator<CopilotChunk> {
  const { consultation, message, history, signal } = options

  /*
   * One vault for the whole turn, request-scoped like every other (§9). It is
   * built here and dies when this generator is done; nothing persists it, and
   * the next turn rebuilds it from a digest assembled in the same fixed order,
   * which is what keeps token numbering stable between messages.
   */
  const vault = new RequestTokenVault()
  const digestResult = deidentify(renderDigest(consultation), vault)

  const system = deidentify(
    buildCopilotSystemPrompt(digestResult.text, GUIDELINE_CORPUS),
    vault,
  ).text

  /*
   * History arrives from the client, so it is tokenised again here rather than
   * trusted. The client holds rehydrated text, which is correct for display and
   * wrong to send back raw, and a turn that skipped the gate would be an egress
   * of exactly the kind the boundary exists to stop.
   */
  const turns: StreamTurn[] = [
    ...history.map((turn) => ({
      role: turn.role === 'doctor' ? ('user' as const) : ('assistant' as const),
      content: deidentify(turn.content, vault).text,
    })),
    { role: 'user' as const, content: deidentify(message, vault).text },
  ]

  const stream = getLLMClient().stream({
    operation: 'copilot_turn',
    system,
    turns,
    tools: COPILOT_TOOLS,
    signal,
  })

  const announced = new Set<string>()
  const emitted = new Set<string>()
  const visible = new ReasoningFilter()

  for await (const chunk of stream) {
    if (chunk.type === 'text') {
      const text = visible.push(chunk.text)
      if (text) yield { type: 'token', text: vault.rehydrate(text) }
      continue
    }

    // Announced once per tool per turn, before its proposal, so the panel can
    // show what the copilot is doing while it does it.
    if (!announced.has(chunk.name)) {
      announced.add(chunk.name)
      const label = TOOL_LABELS[chunk.name as CopilotToolName]
      if (label) yield { type: 'tool', name: chunk.name, label }
    }

    const proposal = toProposal(chunk.name, rehydrateArgs(chunk.args, vault))
    if (!proposal) continue

    /*
     * Deduplicated per turn. Measured against qwen3.7-flash on 15/08/26: a
     * single "add a safety-net line" request produced the identical
     * `edit_note_section` call twice. Two identical cards is not a cosmetic
     * problem, it is a doctor being asked to approve the same edit twice and
     * wondering which one is different.
     */
    const fingerprint = JSON.stringify(proposal)
    if (emitted.has(fingerprint)) continue
    emitted.add(fingerprint)
    yield { type: 'proposal', proposal }
  }

  const tail = visible.flush()
  if (tail) yield { type: 'token', text: vault.rehydrate(tail) }
}

/**
 * Strips the model's reasoning block out of the visible answer.
 *
 * `qwen3.7-flash` emits its chain of thought inside `<think>` tags on the same
 * content channel as the answer, so a naive stream shows the doctor the
 * model's working, and a stray `</think>` printed into the panel on 15/08/26
 * even when the opening tag never arrived.
 *
 * Two properties make this fiddlier than a regex over the finished string.
 * The text is streamed, so a tag can be split across chunks and a filter that
 * matched per chunk would miss it; and there is no finished string to regex,
 * because the point of streaming is that the doctor reads it as it arrives. So
 * this holds back any trailing fragment that could still turn into a tag, and
 * releases it once it provably cannot.
 */
export class ReasoningFilter {
  private inside = false
  private held = ''

  push(text: string): string {
    let buffer = this.held + text
    this.held = ''
    let out = ''

    while (buffer.length > 0) {
      if (this.inside) {
        const close = buffer.indexOf('</think>')
        if (close === -1) {
          // Keep only what could still be part of the closing tag.
          this.held = keepPartial(buffer, '</think>')
          return out
        }
        buffer = buffer.slice(close + '</think>'.length)
        this.inside = false
        continue
      }

      const open = buffer.indexOf('<think>')
      if (open === -1) {
        // A bare `</think>` with no opener has been observed; drop it rather
        // than print it, then keep any fragment that might still become a tag.
        const stray = buffer.indexOf('</think>')
        if (stray !== -1) {
          out += buffer.slice(0, stray)
          buffer = buffer.slice(stray + '</think>'.length)
          continue
        }
        const partial = keepPartial(buffer, '<think>', '</think>')
        out += buffer.slice(0, buffer.length - partial.length)
        this.held = partial
        return out
      }

      out += buffer.slice(0, open)
      buffer = buffer.slice(open + '<think>'.length)
      this.inside = true
    }

    return out
  }

  /** Releases anything held back that never became a tag. */
  flush(): string {
    if (this.inside) {
      this.held = ''
      return ''
    }
    const rest = this.held
    this.held = ''
    return rest
  }
}

/** Length of the longest suffix of `text` that prefixes any of `tags`. */
function keepPartial(text: string, ...tags: string[]): string {
  const longest = Math.max(...tags.map((tag) => tag.length))
  for (let size = Math.min(longest - 1, text.length); size > 0; size -= 1) {
    const suffix = text.slice(text.length - size)
    if (tags.some((tag) => tag.startsWith(suffix))) return suffix
  }
  return ''
}

/**
 * Rehydrates every string in a tool's arguments.
 *
 * Done before validation rather than after, because the proposal is what the
 * doctor reads and then writes to the record. A `text` field still carrying
 * `[PATIENT_1]` would put a de-identification token into a clinical note, which
 * is worse than the leak the tokens exist to prevent: it is a corrupted record
 * that looks deliberate.
 */
function rehydrateArgs(args: unknown, vault: TokenVault): unknown {
  if (typeof args === 'string') return vault.rehydrate(args)
  if (Array.isArray(args)) return args.map((entry) => rehydrateArgs(entry, vault))
  if (args !== null && typeof args === 'object') {
    return Object.fromEntries(
      Object.entries(args as Record<string, unknown>).map(([key, value]) => [
        key,
        rehydrateArgs(value, vault),
      ]),
    )
  }
  return args
}
