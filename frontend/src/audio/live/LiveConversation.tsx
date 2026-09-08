import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * One turn, on its own side of the pane (#278).
 *
 * Speaker 1 sits left and Speaker 2 right, so turn-taking is a shape rather
 * than something read off a label. The 62% cap is doing quieter work: the
 * full-width row this replaces ran to roughly 105 characters on a 936px
 * column, well past the 68ch docs/DESIGN.md sets for prose.
 *
 * The tint follows `SpeakerChip` rather than deciding again, so one turn never
 * carries two different answers to whose it is.
 *
 * **Sides are not roles.** The recogniser numbers speakers; roles are assigned
 * after Stop by the labelling pass. An id that swaps mid-consultation
 * therefore moves the conversation bodily across the pane, which is louder
 * than a chip changing its text. That is the trade this layout makes for
 * legibility, and it is the reason the diarisation config is worth keeping
 * honest rather than a cosmetic detail.
 */
function Turn({
  speaker,
  time,
  opensTurn,
  muted = false,
  children,
}: {
  speaker: string | null
  /** Only on the row that opens a turn; a grouped row would repeat it. */
  time: string | null
  opensTurn: boolean
  /** The unsettled tail, which is quiet until it settles. */
  muted?: boolean
  children: ReactNode
}) {
  const right = speaker === '2'
  return (
    <li
      className={cn(
        // Always two sides, and the cap is what varies. This pane also
        // renders in a 380px rail, where 62% is a 235px bubble breaking every
        // three words; 88% there keeps the offset legible without shredding
        // the measure. The container query is on the width that actually
        // matters, which is the column's, not the viewport's.
        'flex flex-col max-w-[88%] @lg:max-w-[62%]',
        right ? 'items-end self-end' : 'items-start self-start',
        // Rows grouped under one chip sit closer than the gap between turns.
        !opensTurn && '-mt-2',
      )}
    >
      {opensTurn && speaker !== null && (
        <span className={cn('mb-1 flex items-center gap-2', right && 'flex-row-reverse')}>
          <SpeakerChip speaker={speaker} />
          {time !== null && <span className="text-2xs text-ink-muted tabular-nums">{time}</span>}
        </span>
      )}
      <p
        className={cn(
          'rounded-card px-3 py-2 text-sm leading-relaxed',
          right ? 'bg-accent-soft' : 'bg-sunken',
          muted && 'text-ink-muted',
        )}
      >
        {children}
      </p>
    </li>
  )
}

export function LiveConversation({
  segments,
  interim,
  interimSpeaker,
  fill = false,
}: {
  segments: readonly LiveSegment[]
  /** The unsettled tail. Rewritten on every message, so never given a timestamp. */
  interim: string
  interimSpeaker: string | null
  /**
   * Fill the height the parent offers, rather than bounding itself.
   *
   * The inline pane sits inside the capture Card, which is not a
   * height-constrained flex chain, so a percentage height would collapse and it
   * has to carry its own cap. The theatre hands it a real box, and `60vh`
   * inside a full-viewport dialog would strand the newest turn halfway up the
   * screen with empty space under it.
   */
  fill?: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  /*
   * Pinned to the newest turn only while the reader is already there. A doctor
   * who has scrolled up to re-read something said a minute ago must not be
   * yanked back down by the next word the patient says.
   */
  const [pinned, setPinned] = useState(true)
  /*
   * The same fact in a ref, because the effect below needs to read it without
   * depending on it. `setPinned(true)` while already `true` is a React
   * bail-out: no re-render, no effect. With `pinned` as the only dependency
   * that bail-out stranded the follow behaviour completely. The effect ran once
   * on mount, never again as speech arrived, and could not be re-armed, so the
   * pane froze at the first turn while "Jump to latest" stayed hidden, because
   * `pinned` never became false either.
   */
  const pinnedRef = useRef(true)

  const stickToBottom = useCallback(() => {
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
  }, [])

  /** The last conversation state this actually followed, so churn is ignored. */
  const followed = useRef('')

  useEffect(() => {
    /*
     * Derived inside the effect rather than outside it, because the effect has
     * to genuinely read what it depends on. Three things count as the
     * conversation changing: a turn appended, the closing turn extended, and
     * the unsettled tail rewritten.
     *
     * The comparison is what makes depending on `segments` safe.
     * `tokensToSegments` rebuilds the array on every render of the capture
     * panel, so without it this would fire on renders carrying no new speech
     * and fight a smooth scroll already in flight. And a content dependency is
     * what makes it fire at all: appending to an overflow container raises no
     * scroll event and changes no state of its own.
     */
    const tail = `${segments.length}:${segments[segments.length - 1]?.text ?? ''}:${interim}`
    if (tail === followed.current) return
    followed.current = tail

    if (!pinnedRef.current) return
    stickToBottom()
  }, [segments, interim, stickToBottom])

  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    // A slack of a few pixels, because smooth scrolling lands fractionally short.
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    pinnedRef.current = atBottom
    setPinned(atBottom)
  }

  const jumpToLatest = () => {
    pinnedRef.current = true
    setPinned(true)
    // Scrolled here rather than left to the effect, which would not re-run if
    // `pinned` was already true and no new speech has arrived since.
    stickToBottom()
  }

  const last = segments[segments.length - 1]
  const interimJoinsLastTurn =
    interim !== '' && last !== undefined && interimSpeaker === last.speaker

  return (
    <div className={cn('relative', fill && 'flex min-h-0 flex-1 flex-col')}>
      {/*
        Bounded rather than `flex-1` by default: this sits inside the capture
        Card, which is not a height-constrained flex chain, so a percentage
        height would collapse. `60vh` keeps the Stop control reachable without
        scrolling on a laptop, and the floor stops the pane snapping shorter as
        the first turns arrive. Roughly double the 256px it replaced.

        `fill` is the theatre, where the parent is a real flex box and the cap
        would be the thing making the pane too short instead of too tall.
      */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          '@container overflow-y-auto rounded-card bg-surface p-4 shadow-card',
          fill ? 'min-h-0 flex-1' : 'max-h-[min(60vh,32rem)] min-h-48',
        )}
      >
        {segments.length === 0 && interim === '' ? (
          <p className="text-ink-muted text-sm">Text appears as the consultation is spoken.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {segments.map((segment, index) => {
              // Consecutive turns from one speaker drop the chip and the
              // timestamp. That grouping is what makes the column read as a
              // conversation rather than as a log with a label on every line.
              const previous = segments[index - 1]
              const opensTurn = previous === undefined || previous.speaker !== segment.speaker
              const isLast = index === segments.length - 1

              return (
                <Turn
                  key={`${segment.start}-${segment.text}`}
                  speaker={segment.speaker}
                  time={opensTurn ? elapsed(segment.start) : null}
                  opensTurn={opensTurn}
                >
                  {segment.text}
                  {isLast && interimJoinsLastTurn && (
                    <span className="text-ink-muted"> {interim}</span>
                  )}
                </Turn>
              )
            })}

            {/* A speaker change that has not settled yet gets its own row, and
                deliberately no timestamp: it would shift the moment the tokens
                settle and the real one is known. */}
            {interim !== '' && !interimJoinsLastTurn && (
              <Turn speaker={interimSpeaker} time={null} opensTurn muted>
                {interim}
              </Turn>
            )}
          </ol>
        )}
      </div>

      {!pinned && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute right-4 bottom-4 rounded-pill bg-ink px-3 py-1.5 font-medium text-2xs text-surface shadow-card"
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
