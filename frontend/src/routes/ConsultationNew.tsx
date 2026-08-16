import type { Transcript, TranscriptSource, TranscriptTurn } from '@shared/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileUp, FolderOpen, Mic, Type } from 'lucide-react'
import { type ChangeEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AudioCapture } from '../audio/AudioCapture.js'
import {
  type DraftLine,
  draftToTurns,
  proseToDraft,
  segmentsToDraft,
} from '../audio/draft-turns.js'
import { SpeakerAssign } from '../audio/SpeakerAssign.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { parseTranscript, serialiseTurns } from '../lib/transcript.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

/*
 * Ordered by how central each path is to the product, not by how it was built.
 *
 * `fixture` stays the opening tab even though it is last. A reviewer arriving
 * with no microphone and no Malay recording still has to be able to run the
 * pipeline in one click, and defaulting to Record would put an empty capture
 * screen in front of them instead.
 */
const TABS = [
  { id: 'record', label: 'Record', Icon: Mic },
  { id: 'upload', label: 'Upload', Icon: FileUp },
  { id: 'paste', label: 'Paste', Icon: Type },
  { id: 'fixture', label: 'Bundled Case', Icon: FolderOpen },
] as const

export function ConsultationNew() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('fixture')
  const [text, setText] = useState('')
  const [source, setSource] = useState<TranscriptSource>('fixture')
  /*
   * Drafted speaker labels live here, outside the textarea, until the doctor
   * explicitly applies them. While a draft is pending the recording is not in
   * the transcript at all and submission stays disabled, so unreviewed
   * guessed labels can never reach the API (issue #70's suppression shape is
   * why that gate is a safety control rather than UX polish).
   */
  const [draft, setDraft] = useState<DraftLine[] | null>(null)

  const fixtures = useQuery({ queryKey: ['fixtures'], queryFn: api.fixtures })

  const turns = parseTranscript(text)

  const create = useMutation({
    mutationFn: () => {
      const transcript: Transcript = { source, turns }
      return api.createConsultation(transcript)
    },
    onSuccess: (consultation) => navigate(`/consultations/${consultation.id}`),
  })

  const appendText = (addition: string) =>
    setText((current) => (current ? `${current.trimEnd()}\n${addition}` : addition))

  /*
   * Flipping an undrafted line also resolves it. Its speaker was a placeholder
   * the server declared it did not stand behind; once the doctor has picked a
   * side it is theirs, so it stops being marked as needing one.
   *
   * The first tap on an undrafted line keeps the speaker shown and only clears
   * the mark, so choosing the side already displayed takes one tap rather than
   * two.
   */
  const flip = (line: DraftLine): DraftLine => {
    if (line.undrafted) {
      const { undrafted: _resolved, ...rest } = line
      return rest
    }
    return { ...line, speaker: line.speaker === 'doctor' ? 'patient' : 'doctor' }
  }

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const raw = await file.text()
    // A .json transcript is rendered back into the same line format rather
    // than parsed separately, so what the doctor reviews is what is submitted.
    if (file.name.endsWith('.json')) {
      try {
        const parsed: unknown = JSON.parse(raw)
        const list = Array.isArray(parsed) ? parsed : (parsed as { turns?: unknown }).turns
        if (Array.isArray(list)) {
          setText(
            serialiseTurns(
              list.map((turn) => {
                const t = turn as { speaker?: string; text?: string; offsetSeconds?: number }
                const mapped: TranscriptTurn = {
                  speaker: t.speaker === 'doctor' ? 'doctor' : 'patient',
                  text: t.text ?? '',
                }
                if (typeof t.offsetSeconds === 'number' && t.offsetSeconds >= 0) {
                  mapped.offsetSeconds = t.offsetSeconds
                }
                return mapped
              }),
            ),
          )
          setSource('upload')
          return
        }
      } catch {
        // Fall through to treating it as plain text.
      }
    }
    setText(raw)
    setSource('upload')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New Consultation"
        subtitle="Every bundled case is synthetic. No real patient data enters this system."
        art="/art/new-consultation.webp"
      />

      <div
        role="tablist"
        aria-label="Transcript source"
        data-tour="intake"
        className="mt-6 flex flex-wrap gap-1"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-sm font-medium transition-colors',
              tab === id ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-sunken',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'fixture' && (
          <div className="flex flex-col gap-2">
            {fixtures.isPending &&
              [0, 1].map((key) => <Skeleton key={key} className="h-14 w-full" />)}
            {fixtures.data?.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                onClick={() => {
                  setText(serialiseTurns(fixture.transcript.turns))
                  setSource('fixture')
                  setTab('paste')
                }}
                className="rounded-card border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-accent"
              >
                <p className="text-sm font-medium">{fixture.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {fixture.transcript.turns.length} turns
                </p>
              </button>
            ))}
          </div>
        )}

        {tab === 'upload' && (
          <Card className="p-6">
            <label className="flex flex-col items-start gap-2 text-sm">
              <span className="font-medium">Transcript File</span>
              <span className="text-ink-muted">
                A .txt or .json file. It lands in the editor below so you can correct it before
                submitting.
              </span>
              <input
                type="file"
                accept=".txt,.json,text/plain,application/json"
                onChange={onUpload}
                className="mt-2 text-sm file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium"
              />
            </label>
          </Card>
        )}

        {tab === 'record' && (
          <Card className="p-6">
            <AudioCapture
              onTranscript={({ text: transcribed, segments, source: from, draftTurns }) => {
                /*
                 * Appended, never replacing what is already there. A doctor may
                 * record in passes, or have started typing, and silently
                 * discarding either would lose clinical content the same way the
                 * parser's dropped-continuation bug would have.
                 *
                 * Offsets only when this recording is the whole transcript so
                 * far: a later recording's timebase restarts at zero, and a
                 * mixed timebase would assert wrong times in the evidence
                 * trace. Labels still draft; timestamps are dropped.
                 *
                 * The provenance comes from the path the recording actually
                 * took. It is client-asserted and the API cannot verify it,
                 * which is why nothing in the safety architecture rests on it.
                 */
                const withOffsets = text === '' && draft === null
                // Hosted recordings carry server-drafted labels instead of
                // segments (#189); `hosted-` ids are a namespace disjoint from
                // the local `seg-` ones, and the turns carry no offsets, so a
                // wrong timestamp can never be asserted for them.
                //
                // The third branch is the one that keeps this from being a
                // dead end. A hosted recording carries no segments, so when the
                // labelling pass does not return, the first two produce nothing
                // and the doctor is left with a block of prose that parses to
                // zero turns, which is exactly the condition Start Consultation
                // is disabled on. `proseToDraft` applies the same rules to the
                // text alone, so the recording stays usable and the labels stay
                // the doctor's to confirm.
                const hostedLines = (draftTurns ?? []).map(
                  (turn, i): DraftLine => ({
                    id: `hosted-${i}`,
                    speaker: turn.speaker,
                    text: turn.text,
                    // Carried through rather than dropped: a chunk the server
                    // could not label arrives with a placeholder speaker, and
                    // the review list has to say so.
                    ...(turn.undrafted === true ? { undrafted: true } : {}),
                  }),
                )
                const timedLines = segmentsToDraft(segments, transcribed, { withOffsets })
                const lines =
                  hostedLines.length > 0
                    ? hostedLines
                    : timedLines.length > 0
                      ? timedLines
                      : proseToDraft(transcribed)
                if (lines.length > 0) {
                  setDraft((current) =>
                    current
                      ? [
                          ...current,
                          // Appended lines get their own id namespace: reusing
                          // seg-N can collide with a seg id already in the
                          // draft once splits and skipped segments make line
                          // counts diverge from segment indexes.
                          ...lines.map((line, i) => ({
                            ...line,
                            id: `append-${current.length}-${i}`,
                          })),
                        ]
                      : lines,
                  )
                } else {
                  // No usable timing: fall back to the unlabelled prose the
                  // record path produced before #118.
                  appendText(transcribed)
                }
                /*
                 * Hosted is sticky for the rest of the consultation: once any
                 * recording in this transcript went to ILMU, the submitted
                 * provenance says so, even if later passes were on-device.
                 * Downgrading to `asr_local` on a subsequent local recording
                 * would understate where this consultation's audio has been,
                 * and the provenance stamp exists to be read by whoever audits
                 * that later.
                 */
                setSource((current) =>
                  current === 'asr_hosted' || from === 'asr_hosted' ? 'asr_hosted' : 'asr_local',
                )
              }}
            />
            {draft && (
              <SpeakerAssign
                draft={draft}
                onToggle={(id) =>
                  setDraft((current) =>
                    current ? current.map((line) => (line.id === id ? flip(line) : line)) : current,
                  )
                }
                onReplace={(id, nextText) =>
                  setDraft((current) =>
                    current
                      ? current.map((line) => (line.id === id ? { ...line, text: nextText } : line))
                      : current,
                  )
                }
                onSwapAll={() => setDraft((current) => (current ? current.map(flip) : current))}
                onApply={() => {
                  if (!draft) return
                  appendText(serialiseTurns(draftToTurns(draft)))
                  setDraft(null)
                }}
                canInsertPlain={turns.length > 0}
                onInsertPlain={() => {
                  if (!draft) return
                  appendText(draft.map((line) => line.text).join(' '))
                  setDraft(null)
                }}
              />
            )}
          </Card>
        )}

        {tab !== 'fixture' && (
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm font-medium">Transcript</span>
            <textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (source === 'fixture') setSource('paste')
              }}
              rows={14}
              placeholder={'Doctor: What brings you in today?\nPatient: Batuk sudah 3 hari...'}
              className="rounded-card border border-line bg-surface p-3 font-mono text-sm leading-relaxed transition-colors focus:border-accent"
            />
          </label>
        )}
      </div>

      {/*
        Gated on the same tab condition as the textarea above, because this card
        reports on that textarea. On the Bundled Case tab there is no editing
        surface on screen, so a parse count for text the doctor cannot see reads
        as a stray leftover from the tab they came from.
      */}
      {tab !== 'fixture' && (text || draft) && (
        <Card className="mt-4 p-4">
          <p className="text-sm font-medium">
            {turns.length} turn{turns.length === 1 ? '' : 's'} parsed
          </p>
          {turns.length === 0 && !draft && (
            <p className="mt-1 text-sm text-ink-muted">
              No speaker labels found. Prefix each line with <code>Doctor:</code> or{' '}
              <code>Patient:</code>.
            </p>
          )}
          {draft && (
            <p className="mt-1 text-sm text-ink-muted">
              A recording is waiting in the Record tab: check its draft labels and apply them before
              starting.
            </p>
          )}
        </Card>
      )}

      {create.error && (
        <p role="alert" className="mt-4 text-sm text-emergency">
          {create.error instanceof ApiError
            ? create.error.message
            : 'Could not start consultation.'}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        className="mt-6"
        disabled={turns.length === 0 || draft !== null}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Start Consultation
      </Button>
    </div>
  )
}
