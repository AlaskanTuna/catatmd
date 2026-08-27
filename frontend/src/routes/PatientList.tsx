import type { PatientListItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { Card, Skeleton } from '../ui/Card.js'
import { Checkbox } from '../ui/Checkbox.js'
import { PageHeader } from '../ui/PageHeader.js'
import { Select } from '../ui/Select.js'

const VISIT_FILTERS = [
  { value: 'all', label: 'All Patients' },
  { value: 'with-visits', label: 'Has Visits' },
  { value: 'without-visits', label: 'No Visits' },
]

const formatLastSeen = (patient: PatientListItem) => {
  if (patient.lastSeenAt === null) return 'Not seen yet'
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(patient.lastSeenAt))
}

const formatGender = (gender: PatientListItem['gender']) => {
  if (gender === null) return 'Not recorded'
  return gender.charAt(0).toUpperCase() + gender.slice(1)
}

export function PatientList() {
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients })
  const [query, setQuery] = useState('')
  const [visitFilter, setVisitFilter] = useState('all')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const dialog = useRef<HTMLDialogElement>(null)
  const selectAllId = useId()

  const normalisedQuery = query.trim().toLowerCase()
  const filtered = (patients.data ?? []).filter((patient) => {
    const matchesName = (patient.name ?? '').toLowerCase().includes(normalisedQuery)
    const matchesVisits =
      visitFilter === 'all' ||
      (visitFilter === 'with-visits' && patient.consultationCount > 0) ||
      (visitFilter === 'without-visits' && patient.consultationCount === 0)
    return matchesName && matchesVisits
  })
  const selected = filtered.filter((patient) => picked.has(patient.id))
  const allSelected = filtered.length > 0 && selected.length === filtered.length

  const erase = useErasePatients(selected, () => {
    dialog.current?.close()
    setPicked(new Set())
  })

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Patients"
        subtitle="Find a patient record or register one before starting a consultation."
        art="/art/consultations.webp"
        actions={
          <Link
            to="/patients/new"
            className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            Register Patient
          </Link>
        }
      />

      <div data-print="hide" className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search patients"
            placeholder="Search by patient name"
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
          onChange={(value) => {
            setVisitFilter(value)
            setPicked(new Set())
          }}
          className="sm:w-52"
        />
      </div>

      {patients.isPending && (
        <div className="mt-4 flex flex-col gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16 w-full rounded-card" />
          ))}
        </div>
      )}

      {patients.data && (
        <>
          <div className="mt-4 flex min-h-9 items-center justify-between gap-4">
            <label
              htmlFor={selectAllId}
              className="flex cursor-pointer items-center gap-3 text-sm text-ink-muted"
            >
              <Checkbox
                id={selectAllId}
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = selected.length > 0 && !allSelected
                }}
                onChange={() =>
                  setPicked(
                    allSelected ? new Set() : new Set(filtered.map((patient) => patient.id)),
                  )
                }
              />
              <span aria-live="polite">
                {selected.length === 0 ? 'Select all' : `${selected.length} selected`}
              </span>
            </label>
            {selected.length > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="neutral" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 aria-hidden className="size-3.5" />}
                  onClick={() => {
                    erase.reset()
                    dialog.current?.showModal()
                  }}
                >
                  Erase {selected.length}
                </Button>
              </div>
            )}
          </div>

          <Card data-tour="patients" className="mt-2 overflow-hidden">
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                {/*
                 * `bg-sunken`, not `bg-sunken-soft`. The soft token is
                 * `sunken` mixed 60% into `surface`, which lands within a
                 * hair of `--color-ground`, so the header matched the page
                 * behind the card and the labels read as floating over
                 * nothing. `sunken` is a solid token that sits below the
                 * ground and well below the white rows, which separates it
                 * from both. Solid rather than a tint on purpose: a
                 * part-transparent fill has a contrast ratio that depends on
                 * what is behind it.
                 */}
                <thead className="border-b border-line bg-sunken text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="w-12 px-4 py-3">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Age
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Gender
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Visits
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Last Seen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((patient) => {
                    const name = patient.name ?? 'Not recorded'
                    return (
                      <tr key={patient.id} className="transition-colors hover:bg-sunken-soft">
                        <td className="px-4 py-3.5">
                          <Checkbox
                            checked={picked.has(patient.id)}
                            onChange={() => toggle(patient.id)}
                            aria-label={`Select ${name}`}
                          />
                        </td>
                        <th scope="row" className="px-4 py-3.5 font-medium">
                          <Link
                            to={`/patients/${patient.id}`}
                            className="text-ink transition-colors hover:text-accent"
                          >
                            {name}
                          </Link>
                        </th>
                        <td className="px-4 py-3.5 text-ink-muted">
                          {patient.age ?? 'Not recorded'}
                        </td>
                        <td className="px-4 py-3.5 text-ink-muted">
                          {formatGender(patient.gender)}
                        </td>
                        <td className="px-4 py-3.5 text-ink-muted">{patient.consultationCount}</td>
                        <td className="px-4 py-3.5 text-ink-muted">{formatLastSeen(patient)}</td>
                      </tr>
                    )
                  })}
                  {/*
                   * Two different empties, told apart deliberately. "Nobody is
                   * registered" and "your filter excluded everyone" look
                   * identical if they share a string, and they call for
                   * opposite actions — register someone, or clear the filter.
                   * Left-aligned and carrying that action, because an empty
                   * state that only reports absence teaches nothing.
                   */}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-ink-muted">
                        {(patients.data ?? []).length === 0 ? (
                          <div className="flex flex-col items-start gap-3">
                            <span>No patients registered yet.</span>
                            <Link
                              to="/patients/new"
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-3 font-medium text-sm text-surface transition-colors hover:bg-accent-hover"
                            >
                              <Plus aria-hidden className="size-4" />
                              Register A Patient
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-3">
                            <span>No patients match this search and filter.</span>
                            <Button
                              size="sm"
                              variant="neutral"
                              onClick={() => {
                                setQuery('')
                                setVisitFilter('all')
                              }}
                            >
                              Clear Filters
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ErasePatientDialog
        ref={dialog}
        patients={selected}
        pending={erase.isPending}
        progress={erase.progress}
        error={erase.error}
        onConfirm={() => erase.mutate()}
      />
    </div>
  )
}

/**
 * What a patient erasure destroys, as the confirmation needs to state it.
 *
 * Both callers already hold this: the list has `consultationCount` on the row,
 * the profile has the history it just rendered. Taking the shape rather than a
 * `PatientListItem` is what lets the profile reuse the dialog for a selection
 * of one without inventing a list item.
 */
export interface ErasablePatient {
  id: string
  name: string | null
  consultationCount: number
}

interface EraseOutcome {
  patientsErased: number
  consultationsErased: number
  failed: number
}

/**
 * Erases a selection of patients, one request at a time.
 *
 * **Sequential because the server is.** Each erasure appends to the audit hash
 * chain, whose head cannot be raced, and one patient erasure already spans
 * every consultation filed under them. Firing the selection concurrently would
 * be asking the chain to fork.
 *
 * A failure mid-run is recorded and the run continues, because the patients
 * already erased stay erased and abandoning the rest helps nobody. The two
 * realistic causes are a record erased elsewhere in the meantime and the shared
 * erase limiter refusing a long selection, and the caller cannot tell those
 * apart from here, so the wording it reports does not pretend to.
 *
 * A run where nothing at all landed rethrows instead, so the dialog shows an
 * error and stays open rather than reporting a success of zero.
 */
function useErasePatients(patients: ErasablePatient[], onSettled: () => void) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (): Promise<EraseOutcome> => {
      let patientsErased = 0
      let consultationsErased = 0
      let failed = 0
      let lastError: unknown = null

      for (const [index, patient] of patients.entries()) {
        setProgress(`Erasing ${index + 1} of ${patients.length}`)
        try {
          const result = await api.erasePatient(patient.id)
          patientsErased += 1
          consultationsErased += result.erasedConsultationIds.length
        } catch (error) {
          failed += 1
          lastError = error
        }
      }

      if (patientsErased === 0 && lastError !== null) throw lastError
      return { patientsErased, consultationsErased, failed }
    },
    onSuccess: ({ patientsErased, consultationsErased, failed }) => {
      onSettled()
      const erased = `${count(patientsErased, 'patient')} erased, with ${count(consultationsErased, 'consultation')}.`
      // A partial failure is an error even though the run finished, and it gets
      // the longer error duration, because "some of what you asked for did not
      // happen" is the one outcome a doctor may need to act on.
      if (failed > 0) {
        toast.error(
          `${erased} ${count(failed, 'other')} could not be, and may already have been erased or been refused by the erase limit.`,
        )
      } else {
        toast.success(erased)
      }
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['consultations'] })
      return queryClient.invalidateQueries({ queryKey: ['patients'] })
    },
    onSettled: () => setProgress(null),
  })

  return { ...mutation, progress }
}

/**
 * The confirmation, and the one place the system is honest about what erasing a
 * patient actually does.
 *
 * **The consultation count is the point.** Erasing one patient cascades to
 * every visit filed under them, because the transcripts carry the same identity,
 * so "erase 1 patient" is routinely eleven clinical records going at once. A
 * doctor has to see that number before agreeing, not discover it in the toast
 * afterwards.
 *
 * It says "erased", not "deleted", because the row does not go. `erasePatient`
 * nulls the identifying columns and stamps `erasedAt` while the audit chain
 * referencing the record stays intact. Calling that a delete would be a
 * comfortable lie in a product whose whole claim is a tamper-evident record.
 *
 * **The acknowledgement is required rather than decorative.** The destructive
 * button is inert until it is ticked, and the tick is cleared on every close, so
 * reopening the dialog always starts from unticked. A confirmation whose default
 * state is one click from destruction is not a confirmation.
 */
export function ErasePatientDialog({
  ref,
  patients,
  pending,
  progress,
  error,
  onConfirm,
}: {
  ref: React.Ref<HTMLDialogElement>
  patients: ErasablePatient[]
  pending: boolean
  progress: string | null
  error: unknown
  onConfirm: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const acknowledgeId = useId()

  const consultations = patients.reduce((total, patient) => total + patient.consultationCount, 0)
  const close = () => (ref as React.RefObject<HTMLDialogElement | null>).current?.close()

  return (
    <dialog
      ref={ref}
      data-print="hide"
      aria-labelledby="erase-patient-title"
      // Fires on Escape and on every `close()`, which is every way out of this
      // dialog, so the tick cannot survive into a later opening.
      onClose={() => setAcknowledged(false)}
      className="glass-panel m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id="erase-patient-title" className="text-lg font-semibold">
          Erase {count(patients.length, 'patient record')}?
        </h2>

        <ul className="mt-4 flex flex-col gap-1 text-sm">
          <li className="text-ink-muted">
            {count(patients.length, 'patient record')}: name, NRIC, age and gender.
          </li>
          <li className={consultations > 0 ? 'font-medium text-urgent' : 'text-ink-muted'}>
            {count(consultations, 'consultation')} filed to{' '}
            {patients.length === 1 ? 'them' : 'those patients'}, erased with the record.
          </li>
        </ul>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          Consultations are erased because their transcripts carry the same identity. For each one
          the transcript, analysis and edited note go permanently.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          A tamper-evident audit record that the patient existed and was erased is retained, and
          cannot be removed.
        </p>
        <p className="mt-2 text-sm font-medium">This cannot be undone.</p>

        <label
          htmlFor={acknowledgeId}
          className="mt-4 flex cursor-pointer items-start gap-3 rounded-control border border-line bg-surface p-3 text-sm leading-relaxed"
        >
          <Checkbox
            id={acknowledgeId}
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            I understand this erases {count(patients.length, 'patient record')} and{' '}
            {count(consultations, 'consultation')}, and that it cannot be undone.
          </span>
        </label>

        {progress !== null && (
          <p role="status" className="mt-3 text-sm text-ink-muted">
            {progress}
          </p>
        )}
        {error != null && (
          <p role="alert" className="mt-3 text-sm text-emergency">
            {error instanceof ApiError ? error.message : 'Nothing was erased. Please try again.'}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} disabled={!acknowledged} onClick={onConfirm}>
            Erase {patients.length}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
