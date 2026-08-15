import type { ConsultationDetail, CopilotProposal } from '@shared/types'
import { ArrowUp, Check, ChevronDown, Maximize2, Minimize2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import {
  FOLLOW_UP_CHIPS,
  FOLLOW_UP_QUESTIONS,
  OPENING_CHIPS,
  OPENING_QUESTIONS,
  pickRandom,
} from './chips.js'
import { ProposalCard } from './ProposalCard.js'
import { type CopilotMessage, useCopilot } from './use-copilot.js'

/**
 * CatatAI, the review copilot (GitHub issue #169).
 *
 * Three states, matching the pattern this was modelled on: a corner button, a
 * docked panel, and a centred modal for when the doctor wants room to read.
 *
 * **Portalled to `body`, and the expanded state is a real `<dialog>`.** Both
 * follow from one rule in `docs/DESIGN.md`: an element with `backdrop-filter`
 * establishes a backdrop root, so glass nested inside the page's chrome blurs
 * that chrome's flat fill instead of the page and reads as merely translucent.
 * A `<dialog>` renders in the top layer, which is outside every backdrop root,
 * so the modal escapes the problem entirely rather than working around it.
 *
 * **Radii follow the shape rule, which splits on whether a thing is pressed.**
 * The suggestion chips are 10px controls despite being chip-shaped, because
 * pressing one sends a message. Citation chips are 999px, because they are
 * labels that disclose. `docs/DESIGN.md`: round means "this is telling you
 * something", rounded-rect means "this does something".
 */
export function CatatAI({
  consultation,
  onApply,
}: {
  consultation: ConsultationDetail
  /** Applies an approved proposal through the ordinary consultation PATCH. */
  onApply: (proposal: CopilotProposal, reason?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const { messages, send, stop, streaming, error, resolveProposal } = useCopilot(consultation.id)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)

  /*
   * Drawn once per panel session rather than per render, or the four chips
   * would reshuffle on every keystroke.
   *
   * Held in state and redrawn from an effect rather than memoised on a nonce.
   * `useMemo` is a performance hint that React may discard and recompute, so a
   * random draw inside one is not guaranteed stable between renders: the chips
   * could silently reshuffle mid-sentence. State is the honest home for a value
   * that must not change until something asks it to.
   */
  const [opening, setOpening] = useState(() => pickRandom(OPENING_QUESTIONS, OPENING_CHIPS))
  const [followUps, setFollowUps] = useState(() => pickRandom(FOLLOW_UP_QUESTIONS, FOLLOW_UP_CHIPS))

  const answered = messages.length
  useEffect(() => {
    // Redrawn per completed answer so the offered follow-ups move with the
    // conversation rather than sitting static for the whole session. Skipped
    // on an empty panel, where the opening chips are what is showing.
    if (answered === 0) return
    setFollowUps(pickRandom(FOLLOW_UP_QUESTIONS, FOLLOW_UP_CHIPS))
  }, [answered])

  useEffect(() => {
    if (!expanded) {
      dialog.current?.close()
      return
    }
    dialog.current?.showModal()
  }, [expanded])

  useEffect(() => {
    if (messages.length === 0) return
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = (text: string) => {
    if (streaming) return
    setDraft('')
    void send(text)
  }

  const close = () => {
    stop()
    setExpanded(false)
    setOpen(false)
  }

  const showFollowUps = messages.length > 0 && !streaming

  const body = (
    <>
      <header className="flex items-center gap-2 border-line/60 border-b px-4 py-3">
        <img
          src="/art/catatai.webp"
          alt=""
          width={32}
          height={32}
          className="size-8 shrink-0 rounded-full object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink text-sm leading-tight">CatatAI</p>
          <p className="truncate text-ink-muted text-xs">Reviews with you. Never signs off.</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Dock the panel' : 'Expand the panel'}
          title={expanded ? 'Dock' : 'Expand'}
          className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          {expanded ? (
            <Minimize2 aria-hidden className="size-4" />
          ) : (
            <Maximize2 aria-hidden className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Close CatatAI"
          className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-ink-muted text-sm">
              I can see this consultation as it stands now, including your edits. Ask me about the
              record, or pick one of these.
            </p>
            {/* Stated rather than discovered. A doctor who assumes this is saved
                and finds it gone has been misled by silence. */}
            <p className="text-ink-muted text-xs">This conversation is not saved.</p>
          </div>
        )}

        {messages.map((message) => (
          <Turn key={message.id} message={message} onApply={onApply} onResolve={resolveProposal} />
        ))}

        {error && (
          <p role="alert" className="rounded-card bg-emergency/8 px-3 py-2 text-emergency text-sm">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-2 border-line/60 border-t px-4 py-3">
        {(messages.length === 0 || showFollowUps) && (
          <div className="flex flex-wrap gap-1.5">
            {(messages.length === 0 ? opening : followUps).map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => submit(question)}
                disabled={streaming}
                /* 10px, not a pill: pressing this sends a message, and
                   docs/DESIGN.md reserves 999px for labels. */
                className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-left text-ink-muted text-xs transition-colors hover:border-accent/40 hover:text-ink disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit(draft)
          }}
          className="flex items-end gap-2"
        >
          <label className="sr-only" htmlFor="catatai-input">
            Ask CatatAI about this consultation
          </label>
          <textarea
            id="catatai-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit(draft)
              }
            }}
            rows={1}
            placeholder="Ask about this consultation"
            className="max-h-28 min-h-10 flex-1 resize-none rounded-control border border-line bg-surface px-3 py-2.5 text-ink text-sm placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <Button
            type="submit"
            size="md"
            variant="primary"
            disabled={streaming || draft.trim().length === 0}
            aria-label="Send"
            className="size-10 shrink-0 px-0"
          >
            <ArrowUp aria-hidden className="size-4" />
          </Button>
        </form>
      </div>
    </>
  )

  return createPortal(
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setOpening(pickRandom(OPENING_QUESTIONS, OPENING_CHIPS))
          }}
          data-print="hide"
          data-tour="catatai"
          aria-label="Open CatatAI"
          title="CatatAI"
          style={{ zIndex: 'var(--z-sticky)' }}
          className="fab-anchor fixed size-12 overflow-hidden rounded-full shadow-raised ring-1 ring-line transition-transform duration-150 ease-out-quart hover:scale-105 active:scale-[0.94]"
        >
          {/* The mascot is the button, not an icon on a glass disc. It carries
              its own flat ground, so glass behind it would do nothing but cost
              a backdrop root. */}
          <img
            src="/art/catatai.webp"
            alt=""
            width={48}
            height={48}
            className="size-full object-cover"
          />
        </button>
      )}

      {open && !expanded && (
        <div
          data-print="hide"
          style={{ zIndex: 'var(--z-sidebar)' }}
          className="glass fixed right-4 bottom-4 flex h-[min(34rem,calc(100vh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-float md:right-6 md:bottom-6"
        >
          {body}
        </div>
      )}

      <dialog
        ref={dialog}
        data-print="hide"
        onClose={() => setExpanded(false)}
        className="glass-panel m-auto h-[min(80vh,44rem)] w-[min(46rem,calc(100vw-2rem))] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        {expanded && <div className="flex h-full flex-col">{body}</div>}
      </dialog>
    </>,
    document.body,
  )
}

function Turn({
  message,
  onApply,
  onResolve,
}: {
  message: CopilotMessage
  onApply: (proposal: CopilotProposal, reason?: string) => Promise<void>
  onResolve: (cardId: string) => void
}) {
  if (message.role === 'doctor') {
    return (
      <p className="ml-auto w-fit max-w-[85%] rounded-card bg-accent/12 px-3 py-2 text-ink text-sm">
        {message.content}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {message.tools.length > 0 && <ToolRuns runs={message.tools} settled={!message.streaming} />}

      {message.content.length > 0 && (
        <div className="whitespace-pre-wrap text-ink text-sm leading-relaxed">
          {message.content}
          {message.streaming && (
            <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent" />
          )}
        </div>
      )}

      {message.streaming && message.content.length === 0 && message.tools.length === 0 && (
        <p className="text-ink-muted text-sm">Reading the consultation…</p>
      )}

      {message.proposals.map((card) => (
        <ProposalCard
          key={card.id}
          proposal={card.proposal}
          onApply={onApply}
          onResolve={() => onResolve(card.id)}
        />
      ))}
    </div>
  )
}

/**
 * What the copilot did, shown while it does it and collapsed once the answer
 * arrives. Expanded by default mid-turn is the point: an empty bubble for
 * fifteen seconds reads as a hang, and this says which step is taking them.
 */
function ToolRuns({
  runs,
  settled,
}: {
  runs: { name: string; label: string }[]
  settled: boolean
}) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (settled) setOpen(false)
  }, [settled])

  return (
    <div className="rounded-card border border-line bg-sunken/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-ink-muted transition-colors hover:text-ink"
      >
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 transition-transform', open ? '' : '-rotate-90')}
        />
        <span>
          {settled
            ? `${runs.length} ${runs.length === 1 ? 'action' : 'actions'}`
            : (runs.at(-1)?.label ?? 'Working')}
        </span>
        {!settled && (
          <span aria-hidden className="ml-auto size-1.5 animate-pulse rounded-full bg-accent" />
        )}
      </button>
      {open && (
        <ul className="space-y-1 px-2.5 pt-0.5 pb-2 text-ink-muted">
          {/* Keyed on the tool name, which the backend announces once per turn. */}
          {runs.map((run) => (
            <li key={run.name} className="flex items-center gap-1.5">
              <Check aria-hidden className="size-3 text-accent" />
              {run.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
