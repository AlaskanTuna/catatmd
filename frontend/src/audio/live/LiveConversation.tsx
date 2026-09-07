import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.js'
import type { LiveSegment } from './live-tokens.js'

/**
 * The consultation as it is spoken, turn by turn (#219).
 *
 * **This is a reassurance surface, not a reading surface.** The doctor is
 * talking to a patient; the job of this pane is to let them confirm in under a
 * second that the room is being heard, and then look away again. Everything
 * below follows from that: the status cluster is the loud element, the text is
 * quiet, and nothing animates.
 *
 * No token-by-token animation, deliberately. Google Research (CHI 2023) defined
 * a vision-based flicker metric for live captions, validated it against user
 * ratings (N=123, p<0.001), and measured stabilised captions as significantly
 * better on comfort, ease of reading, distraction, fatigue and impairment. A
 * typewriter effect here would cost exactly the eye contact that ambient
 * capture exists to give back.
 */

/** `m:ss` from the segment's own start, which is already seconds. */
const elapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/**
 * Speakers are numbered, never named.
 *
 * The recogniser diarises but does not assign roles: it says "1" and "2" and
 * has no idea which is the doctor. Guessing is measurably unreliable, roughly
 * one utterance in five from linguistic signals alone, and the danger is not
 * that a wrong label looks wrong. It is that it looks plausible, nobody
 * catches it, and it reaches `asserts()` in the red-flag engine, which reads a
 * doctor-question / patient-denial pair as grounds to drop a trigger. Roles are
 * assigned after Stop, by the labelling pass, where they can be reviewed.
 */
function SpeakerChip({ speaker }: { speaker: string }) {
  return (
    <span
      className={cn(
        'rounded-pill px-2 py-0.5 text-2xs font-medium',
        // Colour is redundant reinforcement; the word carries the meaning.
        speaker === '1' ? 'bg-sunken text-ink-muted' : 'bg-accent-soft text-accent',
      )}
    >
      Speaker {speaker}
    </span>
  )
}

export function LiveConversation({
  segments,
  interim,
  interimSpeaker,
}: {
  segments: readonly LiveSegment[]
  /** The unsettled tail. Rewritten on every message, so never given a timestamp. */
  interim: string
  interimSpeaker: string | null
}) {
  const scroller = useRef<HTMLDivElement>(null)
  /*
   * Pinned to the newest turn only while the reader is already there. A doctor
   * who has scrolled up to re-read something said a minute ago must not be
   * yanked back down by the next word the patient says.
   */
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    if (!pinned) return
    const node = scroller.current
    if (!node) return
    /*
     * Both `matchMedia` and `Element.scrollTo` are guarded because jsdom
     * implements neither, and a transcript pane is not worth a global stub in
     * every suite that happens to render one. The fallback is not a no-op:
     * `scrollTop` is supported everywhere and lands in the same place, just
     * without the animation nobody can see in a test anyway.
     */
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ top: node.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
    } else {
      node.scrollTop = node.scrollHeight
    }
  }, [pinned])

  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    // A slack of a few pixels, because smooth scrolling lands fractionally short.
    setPinned(node.scrollHeight - node.scrollTop - node.clientHeight < 24)
  }

  const last = segments[segments.length - 1]
  const interimJoinsLastTurn =
    interim !== '' && last !== undefined && interimSpeaker === last.speaker

  return (
    <div className="relative">
      {/*
        Bounded rather than `flex-1`: this sits inside the capture Card, which
        is not a height-constrained flex chain, so a percentage height would
        collapse. `60vh` keeps the Stop control reachable without scrolling on a
        laptop, and the floor stops the pane snapping shorter as the first turns
        arrive. Roughly double the 256px it replaced.
      */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="max-h-[min(60vh,32rem)] min-h-48 overflow-y-auto rounded-card bg-surface p-4 shadow-card"
      >
        {segments.length === 0 && interim === '' ? (
          <p className="text-ink-muted text-sm">Text appears as the consultation is spoken.</p>
        ) : (
          <ol className="grid gap-1">
            {segments.map((segment, index) => {
              // Consecutive turns from one speaker drop the chip and the
              // timestamp. That grouping is what makes the column read as a
              // conversation rather than as a log with a label on every line.
              const previous = segments[index - 1]
              const opensTurn = previous === undefined || previous.speaker !== segment.speaker
              const isLast = index === segments.length - 1

              return (
                <li
                  key={`${segment.start}-${segment.text}`}
                  className={cn(
                    'grid grid-cols-[3rem_minmax(0,1fr)] gap-3',
                    opensTurn && index > 0 && 'mt-3',
                  )}
                >
                  <span className="pt-0.5 text-2xs text-ink-muted tabular-nums">
                    {opensTurn ? elapsed(segment.start) : ''}
                  </span>
                  <div className="min-w-0">
                    {opensTurn && segment.speaker !== null && (
                      <span className="mb-1 block">
                        <SpeakerChip speaker={segment.speaker} />
                      </span>
                    )}
                    <p className="text-ink text-sm leading-relaxed">
                      {segment.text}
                      {isLast && interimJoinsLastTurn && (
                        <span className="text-ink-muted"> {interim}</span>
                      )}
                    </p>
                  </div>
                </li>
              )
            })}

            {/* A speaker change that has not settled yet gets its own row, and
                deliberately no timestamp: it would shift the moment the tokens
                settle and the real one is known. */}
            {interim !== '' && !interimJoinsLastTurn && (
              <li className="mt-3 grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
                <span />
                <div className="min-w-0">
                  {interimSpeaker !== null && (
                    <span className="mb-1 block">
                      <SpeakerChip speaker={interimSpeaker} />
                    </span>
                  )}
                  <p className="text-ink-muted text-sm leading-relaxed">{interim}</p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute right-4 bottom-4 rounded-pill bg-ink px-3 py-1.5 font-medium text-2xs text-surface shadow-card"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
