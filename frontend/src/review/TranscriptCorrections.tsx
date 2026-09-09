import type { MishearProposal, Transcript } from '@shared/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '../lib/api.js'
import { parseTranscript, serialiseTurns } from '../lib/transcript.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

/**
 * Splice one accepted correction into the transcript it was proposed against.
 *
 * **`source` and `labelsReviewed` are carried through untouched.** The second
 * is the trap this feature has to avoid: it gates the red-flag engine's
 * question-denial suppression, and flipping it would weaken the engine on the
 * strength of the doctor having corrected a single word. Accepting a spelling
 * is not confirming every speaker label on every turn.
 *
 * Exported for its test, and pure so that test needs no component.
 */
export function applyProposal(transcript: Transcript, proposal: MishearProposal): Transcript {
  return {
    ...transcript,
    turns: transcript.turns.map((turn, index) =>
      index === proposal.turnIndex
        ? {
            ...turn,
            text:
              turn.text.slice(0, proposal.start) +
              proposal.suggested +
              turn.text.slice(proposal.start + proposal.original.length),
          }
        : turn,
    ),
  }
}

/** A stable identity for a proposal, so rejecting one does not dismiss another. */
const keyOf = (p: MishearProposal) => `${p.turnIndex}:${p.start}:${p.original}`

/**
 * The words on either side of the proposed span, so the doctor judges the
 * correction in its sentence rather than as a bare word pair.
 */
function context(turnText: string, proposal: MishearProposal) {
  const before = turnText.slice(Math.max(0, proposal.start - 40), proposal.start)
  const after = turnText.slice(
    proposal.start + proposal.original.length,
    proposal.start + proposal.original.length + 40,
  )
  return { before, after }
}

/**
 * The transcript, editable, with measured mishears offered as proposals (#308).
 *
 * **Draft only.** Past `draft` the note was built from these words, so the API
 * refuses a correction and this surface does not render one.
 *
 * **Nothing is applied without the doctor.** Proposals render against the stored
 * text, never a pre-applied repair, and there is deliberately no Accept All:
 * each correction is a separate clinical judgement about a word a recogniser
 * got wrong, and a batch control would collect a single click for all of them.
 * Rejecting writes nothing at all, locally or remotely; it just stops offering.
 *
 * **Accept is disabled while the editor is dirty**, because a proposal's offsets
 * belong to the transcript the server read. Applying one over unsaved edits
 * would either discard those edits or splice at a position that has moved. Save
 * first, and the proposals refetch against what was saved.
 */
export function TranscriptCorrections({
  consultationId,
  transcript,
  onSaved,
}: {
  consultationId: string
  transcript: Transcript
  onSaved: (next: unknown) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => serialiseTurns(transcript.turns))
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())

  const stored = serialiseTurns(transcript.turns)
  const dirty = editing && draft !== stored

  const proposals = useQuery({
    queryKey: ['transcript-corrections', consultationId, stored],
    queryFn: () => api.transcriptCorrections(consultationId),
  })

  const save = useMutation({
    mutationFn: (next: Transcript) => api.setTranscript(consultationId, next),
    onSuccess: (next) => {
      onSaved(next)
      void proposals.refetch()
    },
    onError: () => toast.error('That transcript could not be saved.'),
  })

  const saveEdits = () => {
    const turns = parseTranscript(draft)
    if (turns.length === 0) {
      toast.error('Every line needs a Doctor: or Patient: prefix.')
      return
    }
    // `labelsReviewed` is not set here. The doctor editing text is not the
    // doctor confirming a speaker on every turn, and only the second earns the
    // engine's question-denial suppression.
    save.mutate({ ...transcript, turns })
  }

  const open = (proposals.data ?? []).filter((p) => !rejected.has(keyOf(p)))

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-ink">Correct the transcript</h2>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button size="sm" variant="secondary" onClick={saveEdits} loading={save.isPending}>
              Save changes
            </Button>
          )}
          <Button
            size="sm"
            variant="neutral"
            onClick={() => {
              setDraft(stored)
              setEditing((current) => !current)
            }}
          >
            {editing ? 'Done editing' : 'Edit text'}
          </Button>
        </div>
      </div>

      {editing && (
        <textarea
          aria-label="Transcript"
          className="mt-3 h-64 w-full resize-y rounded-input bg-ground p-3 font-mono text-xs leading-relaxed text-ink"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
      )}

      {open.length === 0 && !editing && (
        <p className="mt-2 text-xs text-ink-muted">
          {proposals.isPending
            ? 'Checking for suspected mishears.'
            : 'No suspected mishears. You can still edit the text yourself.'}
        </p>
      )}

      {open.length > 0 && (
        <section className="mt-4" aria-label="Suspected mishears">
          <h3 className="text-xs font-semibold text-ink">Suspected mishears ({open.length})</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Speech recognition confuses these words in Malay. Each is a separate decision, and
            nothing changes until you accept it.
          </p>

          <ul className="mt-3 space-y-2">
            {open.map((proposal) => {
              const turn = transcript.turns[proposal.turnIndex]
              const { before, after } = context(turn?.text ?? '', proposal)

              return (
                <li
                  key={keyOf(proposal)}
                  className="rounded-input bg-ground p-3 text-xs text-ink-muted"
                >
                  <p className="font-mono leading-relaxed">
                    {before}
                    <mark className="rounded bg-warning-soft px-1 font-semibold text-ink">
                      {proposal.original}
                    </mark>
                    {after}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-ink">
                      Read as <strong className="font-semibold">{proposal.suggested}</strong>?
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Check className="size-3.5" />}
                      disabled={dirty || save.isPending}
                      onClick={() => save.mutate(applyProposal(transcript, proposal))}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="neutral"
                      icon={<X className="size-3.5" />}
                      onClick={() =>
                        setRejected((current) => new Set(current).add(keyOf(proposal)))
                      }
                    >
                      Reject
                    </Button>
                    {dirty && <span className="text-ink-muted">Save your edits first.</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </Card>
  )
}
