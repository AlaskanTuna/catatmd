import { type ConsultationStatus, MAX_PRESCRIPTIONS, type Prescription } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, Mic, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useDemoTour } from '../demo/DemoTour.js'
import { cn } from '../lib/cn.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'
import { PrescriptionTheatre } from './PrescriptionTheatre.js'
import { summarise } from './prescription-draft.js'

/**
 * What was prescribed, as a record rather than a workspace (#313, #365,
 * `docs/decisions.md` D-001).
 *
 * **The compose surface moved out on 10/09/26.** It lived here, in the review
 * page's middle column, which is about 620px wide and is itself an internal
 * scroller. A dictation box three lines tall, a candidate list, six sig fields
 * and a Confirm button do not fit in that column, and most of them were below
 * the fold: a doctor who pressed Accept saw nothing change, because the field it
 * filled was off screen. `PrescriptionTheatre` is where all of that happens now,
 * and this card lists the result.
 *
 * **Two doors, one room.** Dictate opens the theatre already listening; Add
 * opens the same theatre idle with the box focused and no microphone. A doctor
 * who prefers typing gets the full-size surface rather than a half-size form,
 * and one component owns the draft so the two surfaces cannot disagree.
 *
 * **Nothing is stored until the theatre confirms.** Confirming is one ordinary
 * `PATCH /api/consultations/:id { prescriptions }` carrying the whole list, and
 * Remove here is the same call with one entry gone.
 */
export function PrescriptionBlock({
  consultationId,
  prescriptions,
  status,
  patientName,
  onSave,
}: {
  consultationId: string
  /** `null` is the older API answering, and reads the same as none recorded. */
  prescriptions: Prescription[] | null
  status: ConsultationStatus
  patientName?: string
  onSave: (next: Prescription[]) => Promise<unknown>
}) {
  const stored = prescriptions ?? []
  // The PATCH gate is `awaiting_review` alone, so `draft` and `analyzing` 409
  // exactly as `approved` does. `!approved` would be the wrong predicate.
  const editable = status === 'awaiting_review'
  const full = stored.length >= MAX_PRESCRIPTIONS

  const tour = useDemoTour()
  const isPrescriptionStep =
    tour.active === true && tour.steps?.[tour.currentStep]?.target === '[data-tour="prescription"]'
  const [isOpen, setIsOpen] = useState(isPrescriptionStep)
  useEffect(() => {
    if (isPrescriptionStep) setIsOpen(true)
  }, [isPrescriptionStep])
  const bodyId = useId()

  /**
   * `null` is closed. `autoStart` is what separates the two doors: Dictate opens
   * the microphone with the theatre, Add opens a quiet one.
   */
  const [theatre, setTheatre] = useState<{ autoStart: boolean } | null>(null)

  const save = useMutation({ mutationFn: (next: Prescription[]) => onSave(next) })

  // An empty card on a signed note says nothing worth the space.
  if (!editable && stored.length === 0) return null

  return (
    <Card data-tour="prescription" className="mt-5 p-4">
      <h2 className="text-sm font-semibold text-ink">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          className="flex w-full items-center justify-between gap-4 rounded-control text-left transition-colors duration-150 hover:bg-sunken-soft"
        >
          <span>Prescriptions</span>
          <span className="flex items-center gap-2 font-normal text-2xs text-ink-muted">
            {full
              ? `${stored.length} of ${MAX_PRESCRIPTIONS}, limit reached`
              : count(stored.length, 'prescription')}
            <ChevronDown
              aria-hidden
              className={cn(
                'size-4 shrink-0 text-ink-muted transition-transform duration-150',
                isOpen && 'rotate-180',
              )}
            />
          </span>
        </button>
      </h2>

      <div id={bodyId} data-print="block" className={cn(!isOpen && 'hidden')}>
        {editable && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="neutral"
              icon={<Mic aria-hidden className="size-3.5" />}
              disabled={full || save.isPending}
              onClick={() => setTheatre({ autoStart: true })}
            >
              Dictate
            </Button>
            <Button
              size="sm"
              variant="neutral"
              icon={<Plus aria-hidden className="size-3.5" />}
              disabled={full || save.isPending}
              onClick={() => setTheatre({ autoStart: false })}
            >
              Add
            </Button>
          </div>
        )}

        {stored.length === 0 ? (
          /* An empty state is a feature. It names the two ways in and says what
             the doctor keeps control of, rather than reporting a count of
             nothing. */
          <p className="mt-3 rounded-control bg-sunken-soft p-3 text-xs leading-relaxed text-ink-muted">
            Nothing prescribed yet. Press Dictate and read the prescription out loud, or Add to type
            it. Every drug name is yours to accept before it is recorded.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {stored.map((prescription, index) => (
              <li
                key={`${prescription.drug}:${prescription.dictated}`}
                className="flex items-start justify-between gap-3 rounded-control bg-ground p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{prescription.drug}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{summarise(prescription)}</p>
                  <p className="mt-1 text-2xs italic text-ink-muted">
                    Dictated: {prescription.dictated}
                  </p>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant="neutral"
                    icon={<Trash2 aria-hidden className="size-3.5" />}
                    aria-label={`Remove ${prescription.drug}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate(stored.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable && full && (
          <p className="mt-3 text-xs text-ink-muted">
            Ten is the most this record holds. Remove one to add another.
          </p>
        )}
      </div>

      {/* Mounted only while open. The theatre holds a microphone, a worker and a
        recognition config, and a closed `<dialog>` still mounts its children. */}
      {theatre !== null && (
        <PrescriptionTheatre
          consultationId={consultationId}
          stored={stored}
          open
          autoStart={theatre.autoStart}
          patientName={patientName}
          onSave={onSave}
          onClose={() => setTheatre(null)}
        />
      )}
    </Card>
  )
}
