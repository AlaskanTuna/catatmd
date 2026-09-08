import type {
  CaptureMode,
  DraftTurn,
  Transcript,
  TranscriptSource,
  TranscriptTurn,
} from '@shared/types'
import { FileUp, Mic, Settings2, Type } from 'lucide-react'
import { type ChangeEvent, type ReactNode, useRef, useState } from 'react'
import { AudioCapture } from '../audio/AudioCapture.js'
import { AudioSettingsDialog } from '../audio/AudioSettingsDialog.js'
import { type AudioSettings, loadAudioSettings } from '../audio/audio-settings.js'
import {
  type DraftLine,
  draftToTurns,
  proseToDraft,
  segmentsToDraft,
  timeDraftLines,
} from '../audio/draft-turns.js'
import { AmbientCapture } from '../audio/live/AmbientCapture.js'
import type { TranscriptSegment } from '../audio/protocol.js'
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
 * How wide an egress each provenance represents. A transcript's stamp is the
 * highest any of its passes reached, and it never comes back down.
 */
const RECORDED_RANK: Record<TranscriptSource, number> = {
  fixture: 0,
  paste: 0,
  upload: 0,
  asr_local: 1,
  asr_hosted: 2,
  asr_live: 3,
}

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
  captureMode,
  onCapture,
  onCaptureModeChange,
  onCaptureBusyChange,
  saving,
  error,
  onLiveSegments,
  onRecording,
  conversationExpanded,
  onConversationExpandedChange,
  prompter,
  patientName,
}: {
  captureMode: CaptureMode
  onCapture: (transcript: Transcript) => void
  /**
   * The audio behind the transcript, handed to the page that owns the
   * consultation id (#293).
   *
   * Fires only for a pass whose turns carry timing, because that is the only
   * audio the offsets in the transcript can index into. A second recording
   * appended to the same consultation restarts its timebase, so it is
   * deliberately not offered: the page keeps the first pass's audio, and the
   * later turns stay inert.
   */
  onRecording?: (blob: Blob) => void
  onCaptureModeChange: (captureMode: CaptureMode) => void
  onCaptureBusyChange: (busy: boolean) => void
  saving: boolean
  error: string | null
  /**
   * Forwarded to the ambient panel so the review surface can read the
   * consultation while it is still being spoken (#219). Optional and inert on
   * the manual path, which has nothing live to report.
   */
  onLiveSegments?: (segments: readonly TranscriptSegment[]) => void
  /**
   * Forwarded to the ambient panel, which owns the conversation dialog because
   * it owns the live transcript. This component only carries them across; the
   * state and the prompter element both belong to the review page (#287).
   */
  conversationExpanded?: boolean
  onConversationExpandedChange?: (expanded: boolean) => void
  prompter?: ReactNode
  patientName?: string
}) {
  /*
   * The doctor arrived on a consultation page that is already scoped to one
   * patient, so the record's destination is carried by the page itself and is
   * not restated here (removed on the owner's decision 2026-09-02).
   */
  /*
   * The consultation's Capture Mode chooses which panel the Record tab shows,
   * while this device's Audio Settings configure the manual one.
   *
   * The mode used to come from this device's local storage, which let one
   * doctor's preference silently change every later consultation. It now comes
   * from the record itself and is locked as soon as that record has a
   * transcript. Both modes remain working capture paths.
   */
  const [audio, setAudio] = useState<AudioSettings>(loadAudioSettings)
  /*
   * Latched while a session is live, so an in-flight consultation update cannot
   * unmount the running capture and lose the transcript with it. Stop is the
   * only path that delivers text, so nothing may take it away.
   */
  const [ambientLive, setAmbientLive] = useState(false)
  const showAmbient = captureMode === 'ambient' || ambientLive
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(TABS[0].id)
  const audioDialog = useRef<HTMLDialogElement>(null)
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

  /*
   * One handler for both capture panels. Ambient and press-to-record differ in
   * how the audio was captured and where it went, never in what happens to the
   * transcript afterwards, so a second copy of this would be a second place for
   * the provenance rules to drift.
   */
  const applyRecording = ({
    text: transcribed,
    segments,
    source: from,
    draftTurns,
    audio: recording,
  }: {
    text: string
    segments: readonly TranscriptSegment[]
    source: TranscriptSource
    draftTurns?: readonly DraftTurn[]
    audio?: Blob
  }) => {
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
    // Offered on the same condition the offsets are, because the two only mean
    // anything together: audio with no timing cannot be seeked to, and timing
    // from an earlier pass does not index into this recording.
    if (withOffsets && recording) onRecording?.(recording)
    // Hosted recordings carry server-drafted labels instead of
    // segments (#189); `hosted-` ids are a namespace disjoint from
    // the local `seg-` ones. The labels arrive with no timing of
    // their own, and gain it below only where a live capture
    // measured some and it can be located in the words.
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
    /*
     * Ambient carries both halves, so it no longer has to choose (#293). The
     * labelling pass gives the better speakers and the live capture gives real
     * measured timing, and `timeDraftLines` puts the second back onto the
     * first. A turn it cannot locate keeps no timing at all.
     *
     * The hosted relay reaches this line too and is unaffected: it sends no
     * segments, so there is nothing to align against and the lines come back
     * exactly as they went in.
     */
    const labelledLines = withOffsets ? timeDraftLines(hostedLines, segments) : hostedLines
    const lines =
      labelledLines.length > 0
        ? labelledLines
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
     * The widest egress this consultation's audio took, and it only ever
     * widens. Once any pass streamed live or went to ILMU the submitted
     * provenance says so, even if later passes were on-device: downgrading
     * would understate where this consultation's audio has been, and the stamp
     * exists to be read by whoever audits that later.
     *
     * `asr_live` outranks `asr_hosted` because it is the broader claim. The
     * audio left continuously, and it reached a provider our own API never saw
     * it pass through.
     */
    const nextSource = RECORDED_RANK[from] >= RECORDED_RANK[source] ? from : source
    setSource(nextSource)
    submitText(nextText, nextSource)
  }

  /*
   * Returns this consultation to press-to-record. A live session stays mounted
   * until it releases its stream, so no unsent transcript is stranded.
   */
  const switchToManual = () => {
    onCaptureModeChange('manual')
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

        <button
          type="button"
          onClick={() => audioDialog.current?.showModal()}
          aria-label="Audio settings"
          title="Audio settings"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <Settings2 aria-hidden className="size-4" />
        </button>
      </div>

      {/* `showAmbient`, not `captureMode`, so the dialog names the engine
          behind the panel actually on screen: the latch keeps a running
          session mounted through a record update, and the two must not
          disagree while audio is leaving the device. */}
      <AudioSettingsDialog
        ref={audioDialog}
        settings={audio}
        onApply={setAudio}
        ambient={showAmbient}
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
            {showAmbient ? (
              <AmbientCapture
                onTranscript={applyRecording}
                onSwitchToManual={switchToManual}
                onLiveChange={(live) => {
                  setAmbientLive(live)
                  onCaptureBusyChange(live)
                }}
                onLiveSegments={onLiveSegments}
                deviceId={audio.deviceId}
                conversationExpanded={conversationExpanded}
                onConversationExpandedChange={onConversationExpandedChange}
                prompter={prompter}
                patientName={patientName}
              />
            ) : (
              <AudioCapture
                engine={audio.engine}
                transcript={text}
                onTranscript={applyRecording}
                onBusyChange={onCaptureBusyChange}
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
