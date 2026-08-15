import type { ConsultationDetail, Disposition, SoapNote } from '@shared/types'

/**
 * Renders the *current* state of one consultation into the block the copilot
 * reads (GitHub issue #169).
 *
 * **This is the whole of what "live" means here.** There is no subscription,
 * no diffing and no event stream: the digest is rebuilt from the row on every
 * turn, so whatever the doctor has edited, dismissed or acknowledged since the
 * last message is simply what the next prompt says. A copilot that cached this
 * would confidently discuss a note the doctor had already rewritten, which is
 * worse than one that knows nothing.
 *
 * Two properties this file has to hold, both of which are easy to break by
 * accident:
 *
 * **Assembly order is fixed.** The rendered text is de-identified downstream,
 * and `RequestTokenVault` numbers tokens by order of first appearance. Two
 * turns that assembled the same facts in a different order would hand the
 * model `[PATIENT_1]` meaning different people in different messages. Every
 * list below is therefore emitted in a deterministic order, never in whatever
 * order a `Map` or a database happened to yield.
 *
 * **Nothing here is a decision.** The digest states what the record contains
 * and what the doctor has decided. It never scores, ranks by urgency beyond
 * the severity the rules engine already assigned, or suggests what to do.
 */

/**
 * A ceiling on the rendered digest, borrowed from the same reasoning as
 * `max_tokens` on the analysis calls: a long consultation must degrade to a
 * truncated prompt rather than to a provider error mid-sentence. Transcripts
 * are the only unbounded input (`TranscriptSchema` has no `.max()`, so the 1 MB
 * body limit is its only bound), so the transcript is what gets trimmed, and
 * the trim is announced in the text rather than silent.
 */
export const MAX_DIGEST_CHARS = 12_000

/** Longest transcript slice admitted before the notice below replaces the tail. */
const MAX_TRANSCRIPT_CHARS = 7_000

const SECTIONS: readonly (keyof SoapNote)[] = ['subjective', 'objective', 'assessment', 'plan']

function decisionFor(dispositions: readonly Disposition[], id: string): string {
  const decision = dispositions.find((entry) => entry.id === id)
  if (!decision) return 'no decision yet'
  return decision.state === 'dismissed'
    ? `dismissed, reason: ${decision.reason ?? ''}`
    : decision.state.replace(/_/g, ' ')
}

function renderTranscript(consultation: ConsultationDetail): string {
  const turns = consultation.transcript?.turns ?? []
  if (turns.length === 0) return 'No transcript on this consultation.'

  const lines = turns.map(
    (turn) => `${turn.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${turn.text}`,
  )
  const full = lines.join('\n')
  if (full.length <= MAX_TRANSCRIPT_CHARS) return full

  // Keep the opening rather than the tail: the presenting complaint and the
  // history sit at the front, and a copilot that has read only the closing
  // pleasantries is more misleading than one that says it read part.
  const kept = full.slice(0, MAX_TRANSCRIPT_CHARS)
  return `${kept}\n\n[Transcript truncated for length. You have read the first ${MAX_TRANSCRIPT_CHARS} characters of ${full.length}. Say so if the doctor asks about anything later in the consultation.]`
}

function renderNote(consultation: ConsultationDetail): string {
  const note = consultation.editedNote ?? consultation.analysis?.note
  if (!note) return 'No note has been generated yet.'

  const edited = consultation.editedNote !== null
  const header = edited
    ? 'The doctor has edited this note. This is their current text, not the generated draft.'
    : 'This is the generated draft. The doctor has not edited it.'

  const body = SECTIONS.map((section) => {
    const text = note[section]?.trim()
    return `${section}: ${text && text.length > 0 ? text : '(empty)'}`
  }).join('\n')

  return `${header}\n${body}`
}

function renderChecklist(consultation: ConsultationDetail): string {
  const facts = consultation.analysis?.clinicalFacts
  if (!facts) return 'No completeness checklist yet.'

  // Group order is the schema's own, and within a group the key order is the
  // schema's too. Both are literal declarations rather than sorted at runtime,
  // so this walk is stable across turns.
  const lines: string[] = []
  for (const [group, fields] of Object.entries(facts)) {
    if (fields === null || typeof fields !== 'object') continue
    for (const [field, assertion] of Object.entries(fields)) {
      if (assertion === null || typeof assertion !== 'object') continue
      const { state, value } = assertion as { state?: string; value?: string }
      const detail = value && value.trim().length > 0 ? `: ${value}` : ''
      lines.push(`${group}.${field} = ${state ?? 'unknown'}${detail}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No completeness checklist yet.'
}

function renderRedFlags(consultation: ConsultationDetail): string {
  const flags = consultation.analysis?.redFlags ?? []
  if (flags.length === 0) return 'No red flags were raised.'

  return flags
    .map(
      (flag) =>
        `- [${flag.id}] ${flag.severity.toUpperCase()} (${flag.source}): ${flag.label}. Doctor's decision: ${decisionFor(consultation.redFlagDispositions, flag.id)}`,
    )
    .join('\n')
}

function renderGaps(consultation: ConsultationDetail): string {
  const gaps = consultation.analysis?.gaps ?? []
  if (gaps.length === 0) return 'No missing information was identified.'

  return gaps
    .map(
      (gap) =>
        `- [${gap.id}] (${gap.priority}) ${gap.question} Doctor's decision: ${decisionFor(consultation.gapDispositions, gap.id)}`,
    )
    .join('\n')
}

function renderSuggestions(consultation: ConsultationDetail): string {
  const suggestions = consultation.analysis?.suggestions ?? []
  if (suggestions.length === 0) return 'No suggestions were generated.'

  return suggestions
    .map((suggestion) => {
      const ids = suggestion.citations.map((citation) => citation.guidelineId).join(', ')
      return `- ${suggestion.text} [cites: ${ids}]`
    })
    .join('\n')
}

/**
 * The consultation block interpolated into the system prompt.
 *
 * Returned as plain text rather than JSON deliberately. The de-identification
 * gate runs over this string, and a JSON payload would have it rewriting
 * identifiers inside structural syntax, where a tokenised value can change the
 * shape of what the model parses. Prose degrades gracefully; JSON does not.
 */
export function renderDigest(consultation: ConsultationDetail): string {
  const status = consultation.approvedAt
    ? `APPROVED on ${consultation.approvedAt.toISOString().slice(0, 10)} by ${consultation.approvedBy ?? 'the doctor'}. This note is final and cannot be edited.`
    : `Status: ${consultation.status}. Not yet approved.`

  const digest = [
    `## Consultation status\n${status}`,
    `## Transcript\n${renderTranscript(consultation)}`,
    `## Clinical note\n${renderNote(consultation)}`,
    `## Completeness checklist\n${renderChecklist(consultation)}`,
    `## Red flags\n${renderRedFlags(consultation)}`,
    `## Missing information\n${renderGaps(consultation)}`,
    `## Suggestions already generated\n${renderSuggestions(consultation)}`,
  ].join('\n\n')

  if (digest.length <= MAX_DIGEST_CHARS) return digest
  return `${digest.slice(0, MAX_DIGEST_CHARS)}\n\n[Digest truncated for length.]`
}
