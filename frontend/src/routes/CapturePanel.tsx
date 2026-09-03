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
 * create mutation, and a callback where the navigation used to be.
 *
 * The draft speaker-label gate it used to carry is gone. It was a safety control
 * rather than UX polish, so it was replaced rather than dropped: `labelsReviewed`
 * on the submitted transcript tells the red-flag engine whether a person stands
 * behind the labels, and the engine refuses the question-denial reading when
 * nobody does (issue #70, backend/src/redflags/mislabel-suppression.test.ts).
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
  const turns = parseTranscript(text)

  /*
   * `labelsReviewed` says whether a person stands behind the speaker on every
   * turn, and the red-flag engine reads it before it is willing to drop a
   * trigger hit (shared/src/index.ts). True on Paste only, because the doctor
   * typed or edited those prefixes themselves. False on Upload now that the file
   * is submitted without a press, since the prefixes come from the file and
   * nobody confirms them. False on a recording, where they are drafted from the
   * words.
   */
  const submitText = (fullText: string, nextSource: TranscriptSource) => {
    const parsed = parseTranscript(fullText)
    if (parsed.length === 0) return
    onCapture({ source: nextSource, turns: parsed, labelsReviewed: nextSource === 'paste' })
  }

  const submit = () => submitText(text, source)

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
          const serialised = serialiseTurns(
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
          )
          setText(serialised)
          setSource('upload')
          submitText(serialised, 'upload')
          return
        }
      } catch {
        // Fall through to treating it as plain text.
      }
    }
    setText(raw)
    setSource('upload')
    submitText(raw, 'upload')
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* One row: the tabs, then the settings affordance pushed to the end.
        The gear was a labelled button inside the `tablist` itself, which is
        both a stray non-tab child of a tab set and, in a 380px column, wide
        enough to wrap onto a line of its own where it read as stranded. An
        icon fits beside the three tabs at every width the column takes. */}
      <div className="flex items-center justify-between gap-2">
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
        </div>

        <button
          type="button"
          onClick={() => audioDialog.current?.showModal()}
          aria-label={
            audio.mode === 'ambient' ? 'Audio settings, ambient mode on' : 'Audio settings'
          }
          title="Audio settings"
          className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <Settings2 aria-hidden className="size-4" />
          {/* The word "Ambient" was carrying this state before the label went.
              A standing preference that decides whether the room is being
              listened to is not something the doctor should have to open a
              dialog to discover, so it keeps a visible mark. */}
          {audio.mode === 'ambient' && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />
          )}
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

      {/* Centred in the leftover room rather than pinned under the tabs: the
          card grows to the column's floor, and capture is the one thing on
          this screen a doctor came here to do. */}
      <div className="mt-4 flex flex-1 flex-col justify-center">
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
              transcript={text}
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
                const withOffsets = text === ''
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
                /*
                 * The `undrafted` marker the server sets on a span it could not
                 * label is deliberately not carried further. Its only reader was
                 * the review list, which is gone, and a marker nothing reads is
                 * worse than none. The span's placeholder speaker is bounded
                 * instead by `labelsReviewed`, which stops the red-flag engine
                 * trusting any label on this path, drafted or placeholder.
                 */
                const hostedLines = (draftTurns ?? []).map(
                  (turn, i): DraftLine => ({
                    id: `hosted-${i}`,
                    speaker: turn.speaker,
                    text: turn.text,
                  }),
                )
                const timedLines = segmentsToDraft(segments, transcribed, { withOffsets })
                const lines =
                  hostedLines.length > 0
                    ? hostedLines
                    : timedLines.length > 0
                      ? timedLines
                      : proseToDraft(transcribed)
                let addition: string
                if (lines.length > 0) {
                  /*
                   * Applied straight into the transcript. This used to park the
                   * lines in a draft the doctor confirmed line by line before
                   * anything was inserted; that review step is gone, because the
                   * workflow it belonged to is being replaced by one where the
                   * note and the safety panels fill while the doctor is still
                   * talking, and there is no moment in that to tweak labels.
                   *
                   * The safety the gate was providing did not come from the
                   * doctor's eyes on the labels, it came from the red-flag
                   * engine being allowed to trust them. That trust now travels
                   * with the transcript instead: `labelsReviewed` is false here,
                   * and `backend/src/redflags/triggers.ts` will not drop a
                   * trigger hit on a question-denial reading it cannot stand
                   * behind.
                   */
                  addition = serialiseTurns(draftToTurns(lines))
                } else {
                  // No usable timing: fall back to the unlabelled prose the
                  // record path produced before #118.
                  addition = transcribed
                }
                /*
                 * Composed once and used for both, because the doctor must
                 * never be shown one transcript while a different one is
                 * submitted. Appending through a state updater and recomposing
                 * the submitted string separately would give two answers to
                 * the same question.
                 */
                const nextText = text ? `${text.trimEnd()}\n${addition}` : addition
                setText(nextText)
                /*
                 * Hosted is sticky for the rest of the consultation: once any
                 * recording in this transcript went to ILMU, the submitted
                 * provenance says so, even if later passes were on-device.
                 * Downgrading to `asr_local` on a subsequent local recording
                 * would understate where this consultation's audio has been,
                 * and the provenance stamp exists to be read by whoever audits
                 * that later.
                 */
                const nextSource =
                  source === 'asr_hosted' || from === 'asr_hosted' ? 'asr_hosted' : 'asr_local'
                setSource(nextSource)
                submitText(nextText, nextSource)
              }}
            />
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
      {error && (
        <p role="alert" className="mt-4 text-sm text-emergency">
          {error}
        </p>
      )}

      {tab === 'paste' && (
        <Button
          variant="primary"
          size="lg"
          className="mt-6"
          disabled={turns.length === 0}
          loading={saving}
          onClick={submit}
        >
          Use This Transcript
        </Button>
      )}
    </div>
  )
}
