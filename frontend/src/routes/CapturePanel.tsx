import type { Transcript, TranscriptSource, TranscriptTurn } from '@shared/types'
import { FileUp, Mic, Settings2, Type } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { AudioCapture } from '../audio/AudioCapture.js'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog.js'
import { type AudioSettings, loadAudioSettings } from '../audio/audio-settings.js'
import {
  type DraftLine,
  draftToTurns,
  proseToDraft,
  segmentsToDraft,
} from '../audio/draft-turns.js'
import { SpeakerAssign } from '../audio/SpeakerAssign.js'
import { cn } from '../lib/cn.js'
import { parseTranscript, serialiseTurns } from '../lib/transcript.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'

/*
 * Ordered by how central each path is to the product, not by how it was built,
 * and the first tab is the one that opens.
 */
const TABS = [
  { id: 'record', label: 'Record', Icon: Mic },
  { id: 'upload', label: 'Upload', Icon: FileUp },
  { id: 'paste', label: 'Paste', Icon: Type },
] as const

/**
 * Capture, mounted inside the consultation it writes into.
 *
 * This was a page of its own — `/consultations/new` — which assembled a
 * transcript first and created the record only once it was complete. That
 * ordering is what made a consultation something you finished before it
 * existed, and it is why the record could not be filed to a patient until the
 * very end. The record now comes first and this writes into it.
 *
 * Everything here is unchanged from that page except its edges: no routing, no
 * create mutation, and a callback where the navigation used to be. The draft
 * speaker-label gate in particular is carried over intact, because it is a
 * safety control rather than UX polish (issue #70).
 */
export function CapturePanel({
  onCapture,
  saving,
  error,
}: {
  onCapture: (transcript: Transcript) => void
  saving: boolean
  error: string | null
}) {
  /*
   * The doctor arrived on a consultation page that is already scoped to one
   * patient, so the record's destination is carried by the page itself and is
   * not restated here (removed on the owner's decision 2026-09-02).
   */
  const [audio, setAudio] = useState<AudioSettings>(loadAudioSettings)
  /*
   * Record is the default tab, except when ambient mode has already taken the
   * microphone. Opening on a tab the doctor cannot use is the same dead end as
   * blocking one without saying why.
   */
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(() =>
    loadAudioSettings().mode === 'ambient' ? 'paste' : TABS[0].id,
  )
  const audioDialog = useRef<HTMLDialogElement>(null)
  /*
   * Ambient mode already listens to the room for the whole session, so pressing
   * record here would start a second capture of the same consultation. The tab
   * is blocked rather than hidden: a control that vanishes reads as a bug, and
   * the doctor needs to know the mode is on, not merely that recording is gone.
   */
  const recordBlocked = audio.mode === 'ambient'
  const [text, setText] = useState('')
  const [source, setSource] = useState<TranscriptSource>('paste')
  /*
   * Drafted speaker labels live here, outside the textarea, until the doctor
   * explicitly applies them. While a draft is pending the recording is not in
   * the transcript at all and submission stays disabled, so unreviewed
   * guessed labels can never reach the API (issue #70's suppression shape is
   * why that gate is a safety control rather than UX polish).
   */
  const [draft, setDraft] = useState<DraftLine[] | null>(null)

  const turns = parseTranscript(text)

  const submit = () => onCapture({ source, turns })

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
    <div>
      <div role="tablist" aria-label="Transcript source" className="flex flex-wrap gap-1">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-disabled={id === 'record' && recordBlocked}
            onClick={() => {
              if (id === 'record' && recordBlocked) return
              setTab(id)
            }}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-sm font-medium transition-colors',
              tab === id ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-sunken',
              id === 'record' &&
                recordBlocked &&
                'cursor-not-allowed opacity-50 hover:bg-transparent',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => audioDialog.current?.showModal()}
          aria-label="Audio settings"
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-ink-muted text-sm transition-colors hover:bg-sunken"
        >
          <Settings2 aria-hidden className="size-4" />
          {audio.mode === 'ambient' ? 'Ambient' : 'Audio'}
        </button>
      </div>

      {recordBlocked && (
        <p className="mt-2 text-ink-muted text-xs">
          Ambient mode is on, so the room is already being listened to. Turn it off in Audio to
          record a single consultation by hand.
        </p>
      )}

      <AudioSettingsDialog
        ref={audioDialog}
        settings={audio}
        onApply={(next) => {
          setAudio(next)
          // Leaving the doctor on a tab they can no longer use would strand
          // them on a dead panel with no way to tell why it stopped working.
          if (next.mode === 'ambient' && tab === 'record') setTab('paste')
        }}
      />

      <div className="mt-4">
        {tab === 'upload' && (
          <Card className="p-6">
            <label className="flex flex-col items-start gap-2 text-sm">
              <span className="font-medium">Transcript File</span>
              <span className="text-ink-muted">
                A .txt or .json file. It lands in the Paste tab so you can correct it before
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
              engine={audio.engine}
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

        {/*
          The textarea is the paste path's own surface, not a shared one: on
          Record and Upload the doctor has just been given a different way to
          fill the transcript, and a second editing field beside it reads as a
          stray leftover rather than as a destination.
        */}
        {tab === 'paste' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Transcript</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={14}
              placeholder={'Doctor: What brings you in today?\nPatient: Batuk sudah 3 hari...'}
              className="rounded-card border border-line bg-surface p-3 font-mono text-sm leading-relaxed transition-colors focus:border-accent"
            />
          </label>
        )}
      </div>

      {/*
        Reports on the transcript the tabs fill. Shown on every tab once there
        is content to report on, because a recording applied in Record lands in
        the same text and the doctor needs its parse count wherever they are.
      */}
      {/* A bordered strip, not a second Card. Two stacked cards of equal weight
          read as two subjects, and this one only reports on the card above it. */}
      {(text || draft) && (
        <div className="mt-4 rounded-card border border-line bg-sunken p-3">
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
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-emergency">
          {error}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        className="mt-6"
        disabled={turns.length === 0 || draft !== null}
        loading={saving}
        onClick={submit}
      >
        Use This Transcript
      </Button>
    </div>
  )
}
