import { applyMishearProposal, type MishearProposal, type Transcript } from '@shared/types'
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
 * **The body moved to `shared/` in #309 and this is now a re-export**, because
 * the server has to compute the same thing: before offering a model proposal it
 * asks whether accepting it would remove a red flag, and it can only ask that of
 * the exact transcript this function would produce. Two implementations would
 * have let the safety check drift off the transcript the doctor actually saves.
 *
 * `source` and `labelsReviewed` are still carried through untouched. The second
 * is the trap: it gates the red-flag engine's question-denial suppression, and
 * accepting a spelling is not confirming every speaker label on every turn.
 *
 * Still exported here for its test, and still pure.
 */
export const applyProposal = applyMishearProposal

/**
 * A stable identity for a proposal, so rejecting one does not dismiss another.
 *
 * `source` is part of it because the two layers can land on the same word: the
 * measured table and the model may both propose a correction at one position,
 * and rejecting the model's guess must not silently dismiss the measured one.
 */
const keyOf = (p: MishearProposal) => `${p.source}:${p.turnIndex}:${p.start}:${p.original}`

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

  const open = (proposals.data?.proposals ?? []).filter((p) => !rejected.has(keyOf(p)))
  /*
   * Surfaced only when the constrained pass ran and fell over, never when it is
   * switched off. A doctor has no use for an env flag, but they do need to know
   * that a check they might assume happened did not: an empty list after a
   * failure is not the same claim as an empty list after a clean run.
   */
  const cleanupFailed = proposals.data?.cleanup === 'failed'

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

      {cleanupFailed && !editing && (
        <p className="mt-2 text-xs text-ink-muted">
          The additional check for less common mishears did not run this time. Anything it would
          have found is not listed below.
        </p>
      )}

      {open.length > 0 && (
        <section className="mt-4" aria-label="Suspected mishears">
          <h3 className="text-xs font-semibold text-ink">Suspected mishears ({open.length})</h3>
          {/*
            Deliberately no longer says "speech recognition confuses these words
            in Malay". That is a measured claim about the confusable table, and
            this list can now also carry model suggestions, which are measured by
            nothing. Each row says which it is; this line no longer says
            something true of only half of them.
          */}
          <p className="mt-1 text-xs text-ink-muted">
            Each is a separate decision, and nothing changes until you accept it.
          </p>

          <ul className="mt-3 space-y-2">
            {open.map((proposal) => {
              const turn = transcript.turns[proposal.turnIndex]
              const { before, after } = context(turn?.text ?? '', proposal)
              const measured = proposal.source === 'mishear'

              return (
                <li
                  key={keyOf(proposal)}
                  className="rounded-input bg-ground p-3 text-xs text-ink-muted"
                >
                  <p className="font-mono leading-relaxed">
                    {before}
                    {/*
                      A solid underline rather than a filled mark (#321). The
                      class this used, `bg-warning-soft`, names a theme variable
                      that does not exist, so Tailwind emitted no rule and the
                      browser default took over. It is an underline rather than
                      a new colour because that is a design-system decision this
                      PR should not be making, and because it puts the span on
                      the axis PR #322 already established in this workflow: a
                      dotted underline means the recogniser was unsure, and a
                      solid one means a correction is on offer.
                    */}
                    <span className="font-semibold text-ink underline decoration-ink decoration-2 underline-offset-4">
                      {proposal.original}
                    </span>
                    {after}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-ink">
                      Read as <strong className="font-semibold">{proposal.suggested}</strong>?
                    </span>
                    {/*
                      Which layer proposed this, said plainly. The measured table
                      has a recorded failure behind every pair it offers; the
                      model pass does not, and a doctor deciding between two
                      words is entitled to know which kind of claim they are
                      being shown.
                    */}
                    {/*
                      "Known confusable" rather than "known mishear": the pair is
                      what has evidence behind it, not this instance. Calling it a
                      mishear would assert that this word is wrong, which is the
                      doctor's call and the reason nothing here auto-applies.
                    */}
                    <span className="rounded-pill bg-sunken px-2 py-0.5 text-2xs font-medium text-ink-muted">
                      {measured ? 'Known confusable' : 'Model suggestion'}
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
