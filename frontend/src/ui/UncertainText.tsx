import type { TextRange } from '@shared/types'
import type { ReactNode } from 'react'

/**
 * A turn's text, with the words the recogniser doubted marked (issue #309).
 *
 * **A dotted underline, deliberately not a highlight.** A filled mark is what
 * this codebase uses for a finding the doctor is being asked to decide about,
 * and this is not one: nothing here claims a word is wrong, only that the
 * recogniser was unsure of it. A cue at the weight of a spellcheck squiggle is
 * the honest rendering, and it also survives being wrong. A transcript with an
 * over-eager threshold reads as a transcript with some underlining; the same
 * transcript in filled marks reads as a broken one.
 *
 * The underline is not the only carrier, because a colour or a decoration alone
 * fails anyone who cannot see it. The surfaces that render this also say what
 * the convention means in words, once, beneath the transcript.
 *
 * Composed from React nodes rather than an HTML string. `dangerouslySetInnerHTML`
 * is zero repo-wide (`.claude/rules/security.md`) and transcript text is
 * patient speech, which is exactly the input that must never become markup.
 */
export function UncertainText({
  text,
  uncertain,
}: {
  text: string
  uncertain?: readonly TextRange[]
}) {
  if (uncertain === undefined || uncertain.length === 0) return text

  const parts: ReactNode[] = []
  let cursor = 0

  for (const [index, range] of uncertain.entries()) {
    /*
     * Clamped rather than trusted. `TranscriptTurnSchema` asserts these are
     * ordered, non-overlapping and inside the text, but this component also
     * renders live segments, which never pass through it. A range that ran
     * backwards or past the end would drop or duplicate the words around it,
     * and the doctor would be reading a turn nobody said.
     */
    const start = Math.min(Math.max(range.start, cursor), text.length)
    const end = Math.min(Math.max(range.end, start), text.length)
    if (end === start) continue

    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <span
        key={`${start}-${end}-${index}`}
        className="underline decoration-ink-muted decoration-dotted decoration-from-font underline-offset-4"
      >
        {text.slice(start, end)}
      </span>,
    )
    cursor = end
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

/**
 * What the underline means, said once beneath a transcript that carries any.
 *
 * Separate from the marks themselves so a surface can place it where it reads
 * as a caption rather than as an interruption, and so nothing renders it when
 * there is nothing to explain.
 */
export function UncertainLegend({ className }: { className?: string }) {
  return (
    <p className={className}>
      Underlined words are ones speech recognition was unsure of. They are a prompt to re-read, not
      a claim that anything is wrong.
    </p>
  )
}
