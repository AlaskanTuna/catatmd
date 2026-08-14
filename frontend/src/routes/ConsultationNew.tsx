import type { Transcript, TranscriptSource, TranscriptTurn } from '@shared/types'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileUp, FolderOpen, Mic, Type } from 'lucide-react'
import { type ChangeEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AudioCapture } from '../audio/AudioCapture.js'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

/**
 * One parser for every input path (#2).
 *
 * Fixture, paste and upload all land in the same textarea and go through the
 * same `Doctor:` / `Patient:` line parser. Keeping one parser is what stops the
 * paths drifting: a bug fixed for upload is fixed for all three, and the
 * doctor can always see and correct exactly what will be submitted.
 */
export function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const line of raw.split('\n')) {
    const match = /^\s*(doctor|patient)\s*:\s*(.+)$/i.exec(line)
    if (match?.[1] && match[2]?.trim()) {
      turns.push({
        speaker: match[1].toLowerCase() === 'doctor' ? 'doctor' : 'patient',
        text: match[2].trim(),
      })
      continue
    }
    // A continuation line belongs to the turn above it rather than being
    // dropped: pasted transcripts wrap, and silently losing a wrapped clause
    // would lose clinical content.
    const previous = turns.at(-1)
    if (previous && line.trim()) previous.text = `${previous.text} ${line.trim()}`
  }
  return turns
}

const TABS = [
  { id: 'fixture', label: 'Bundled Case', Icon: FolderOpen },
  { id: 'paste', label: 'Paste', Icon: Type },
  { id: 'upload', label: 'Upload', Icon: FileUp },
  { id: 'record', label: 'Record', Icon: Mic },
] as const

export function ConsultationNew() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('fixture')
  const [text, setText] = useState('')
  const [source, setSource] = useState<TranscriptSource>('fixture')

  const fixtures = useQuery({ queryKey: ['fixtures'], queryFn: api.fixtures })

  const turns = parseTranscript(text)

  const create = useMutation({
    mutationFn: () => {
      const transcript: Transcript = { source, turns }
      return api.createConsultation(transcript)
    },
    onSuccess: (consultation) => navigate(`/consultations/${consultation.id}`),
  })

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
            list
              .map((turn) => {
                const t = turn as { speaker?: string; text?: string }
                return `${t.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${t.text ?? ''}`
              })
              .join('\n'),
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
              tab === id ? 'bg-accent/12 text-accent' : 'text-ink-muted hover:bg-sunken',
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
                  setText(
                    fixture.transcript.turns
                      .map(
                        (turn) =>
                          `${turn.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${turn.text}`,
                      )
                      .join('\n'),
                  )
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
              onTranscript={(transcribed) => {
                /*
                 * Appended, never replacing what is already there. A doctor may
                 * record in passes, or have started typing, and silently
                 * discarding either would lose clinical content the same way the
                 * parser's dropped-continuation bug would have.
                 *
                 * `asr_local` is the honest provenance: transcribed on device.
                 * It is client-asserted and the API cannot verify it, which is
                 * why nothing in the safety architecture rests on it.
                 */
                setText((current) =>
                  current ? `${current.trimEnd()}\n${transcribed}` : transcribed,
                )
                setSource('asr_local')
              }}
            />
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

      {text && (
        <Card className="mt-4 p-4">
          <p className="text-sm font-medium">
            {turns.length} turn{turns.length === 1 ? '' : 's'} parsed
          </p>
          {turns.length === 0 && (
            <p className="mt-1 text-sm text-ink-muted">
              No speaker labels found. Prefix each line with <code>Doctor:</code> or{' '}
              <code>Patient:</code>.
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
        disabled={turns.length === 0}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Start Consultation
      </Button>
    </div>
  )
}
