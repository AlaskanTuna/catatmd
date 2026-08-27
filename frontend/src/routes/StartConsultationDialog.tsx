import type { PatientListItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { Skeleton } from '../ui/Card.js'
import { Select } from '../ui/Select.js'

/**
 * Mirrors the filter on `/patients` rather than inventing a second vocabulary
 * for the same idea. Two lists of patients that filter by different words are
 * two things to learn.
 */
const VISIT_FILTERS = [
  { value: 'all', label: 'All Patients' },
  { value: 'with-visits', label: 'Has Visits' },
  { value: 'without-visits', label: 'No Visits' },
]

/**
 * Three rows, then it scrolls. Sized so a fourth row is half visible, which is
 * what tells the reader there is more without a scrollbar having to.
 */
const LIST_HEIGHT = 'max-h-[15rem]'

const formatMeta = (patient: PatientListItem) => {
  const age = patient.age === null ? null : `${patient.age}`
  const gender =
    patient.gender === null
      ? null
      : patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)
  const parts = [age, gender].filter((part): part is string => part !== null)
  return parts.length === 0 ? 'No details recorded' : parts.join(' · ')
}

const formatLastSeen = (patient: PatientListItem) =>
  patient.lastSeenAt === null
    ? 'Not seen yet'
    : `Last seen ${new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short' }).format(
        new Date(patient.lastSeenAt),
      )}`

/**
 * The question a consultation actually starts with: is this someone we know?
 *
 * `New Consultation` used to link to `/patients`, which answered a different
 * question. It showed the file room and left the doctor to work out that the
 * next step was to open a record and press a second button.
 *
 * This asks the binary directly, and answering it *is* the action: picking an
 * existing patient creates the consultation and opens it, rather than routing
 * to their profile to press Start there. That is the whole reason this is not
 * simply a link to the list it partly resembles. Registering is the other half
 * of the same question, so it sits on the same surface rather than behind a
 * separate control elsewhere on the page.
 */
export function StartConsultationDialog({
  ref,
  onClose,
}: {
  ref: React.RefObject<HTMLDialogElement | null>
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'choice' | 'existing'>('choice')
  const [query, setQuery] = useState('')
  const [visitFilter, setVisitFilter] = useState('all')
  const search = useRef<HTMLInputElement>(null)

  const patients = useQuery({
    queryKey: ['patients'],
    queryFn: api.listPatients,
    // Nothing is fetched until the doctor says the patient already exists, so
    // opening this to register costs no request.
    enabled: mode === 'existing',
  })

  const start = useMutation({
    mutationFn: (patientId: string) => api.createConsultation(undefined, patientId),
    onSuccess: (consultation) => {
      void queryClient.invalidateQueries({ queryKey: ['consultations'] })
      ref.current?.close()
      navigate(`/consultations/${consultation.id}`)
    },
  })

  // The panel grows into existence, so focus has to be moved deliberately.
  // Otherwise it stays on a card that has just become a heading, and the
  // keyboard path dead-ends at the moment the useful control appears.
  useEffect(() => {
    if (mode === 'existing') search.current?.focus()
  }, [mode])

  const reset = () => {
    setMode('choice')
    setQuery('')
    setVisitFilter('all')
    start.reset()
  }

  const normalised = query.trim().toLowerCase()
  const matches = (patients.data ?? [])
    .filter((patient) => {
      const byName = (patient.name ?? '').toLowerCase().includes(normalised)
      const byVisits =
        visitFilter === 'all' ||
        (visitFilter === 'with-visits' && patient.consultationCount > 0) ||
        (visitFilter === 'without-visits' && patient.consultationCount === 0)
      return byName && byVisits
    })
    // Most recently relevant first. A patient registered minutes ago and not
    // yet seen is exactly who a receptionist is about to start a visit for, so
    // registration time stands in when there is no visit to sort by.
    .sort(
      (a, b) => Date.parse(b.lastSeenAt ?? b.createdAt) - Date.parse(a.lastSeenAt ?? a.createdAt),
    )

  return (
    <dialog
      ref={ref}
      data-print="hide"
      aria-labelledby="start-consultation-title"
      onClose={() => {
        reset()
        onClose?.()
      }}
      className="glass-panel m-auto w-[30rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        {/* An X rather than a Cancel footer, because both cards are terminal:
            there is nothing here to confirm, so a button that only means "not
            this" belongs beside the title. Escape closes it too, but a doctor
            looking for the way out looks for the corner. */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="start-consultation-title" className="font-display text-lg font-semibold">
              New Consultation
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Every visit is filed to a patient. Who is this one for?
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-mt-1 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <ChoiceCard
            icon={<UserPlus aria-hidden className="size-6" />}
            label="New Patient"
            hint="Register first"
            selected={false}
            onClick={() => {
              ref.current?.close()
              navigate('/patients/new')
            }}
          />
          <ChoiceCard
            icon={<Users aria-hidden className="size-6" />}
            label="Existing Patient"
            hint="Search records"
            selected={mode === 'existing'}
            aria-expanded={mode === 'existing'}
            onClick={() => setMode('existing')}
          />
        </div>

        {/* `grid-rows-[0fr]` to `[1fr]` is the one height transition that works
            on content of unknown height without measuring it in JS. The inner
            `min-h-0 overflow-hidden` is what makes the collapsed row actually
            clip rather than refuse to shrink. */}
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-300 ease-out-quart motion-reduce:transition-none',
            mode === 'existing' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
                  />
                  <input
                    ref={search}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search patients"
                    placeholder="Search by patient name"
                    // Untabbable while collapsed. The panel is clipped rather
                    // than unmounted, so without this the keyboard path runs
                    // straight into controls nobody can see.
                    tabIndex={mode === 'existing' ? undefined : -1}
                    className="h-11 w-full rounded-control border border-line bg-surface pr-10 pl-10 text-sm text-ink transition-colors duration-150 hover:border-accent focus:border-accent"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Clear patient search"
                      className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  )}
                </div>
                <Select
                  label="Filter by visit history"
                  value={visitFilter}
                  options={VISIT_FILTERS}
                  onChange={setVisitFilter}
                  className="sm:w-44"
                />
              </div>

              <div className={cn('mt-3 flex flex-col gap-1.5 overflow-y-auto pr-1', LIST_HEIGHT)}>
                {patients.isPending &&
                  [0, 1, 2].map((key) => <Skeleton key={key} className="h-16 rounded-card" />)}

                {patients.data && matches.length === 0 && (
                  <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
                    {patients.data.length === 0
                      ? 'No patients registered yet.'
                      : 'No patient matches that search.'}
                  </p>
                )}

                {matches.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    disabled={start.isPending}
                    onClick={() => start.mutate(patient.id)}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left transition-colors duration-150 hover:border-accent hover:bg-sunken-soft disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {patient.name ?? 'Unnamed patient'}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {formatMeta(patient)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {formatLastSeen(patient)}
                    </span>
                  </button>
                ))}
              </div>

              {start.error != null && (
                <p role="alert" className="mt-3 text-sm text-emergency">
                  {start.error instanceof ApiError
                    ? start.error.message
                    : 'The consultation could not be started.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  )
}

/**
 * Square rather than a row, because the two options are peers and a stack reads
 * as a ranking. Neither is the default: a clinic's first week is all new
 * patients and its second is mostly returning ones, and guessing wrong costs
 * the same click either way.
 */
function ChoiceCard({
  icon,
  label,
  hint,
  selected,
  onClick,
  ...rest
}: {
  icon: React.ReactNode
  label: string
  hint: string
  selected: boolean
  onClick: () => void
} & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-card border text-center transition-[border-color,background-color,transform] duration-150 ease-out-quart active:scale-[0.97]',
        selected
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line bg-surface text-ink hover:border-accent hover:bg-sunken-soft',
      )}
      {...rest}
    >
      <span className={selected ? 'text-accent' : 'text-ink-muted'}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </button>
  )
}
