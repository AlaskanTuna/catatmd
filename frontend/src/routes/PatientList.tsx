import type { PatientListItem } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
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
              <Button size="sm" variant="neutral" onClick={() => setPicked(new Set())}>
                Clear Selection
              </Button>
            )}
          </div>

          <Card className="mt-2 overflow-hidden">
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead className="bg-sunken-soft text-xs text-ink-muted">
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
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-ink-muted">
                        No patients match this search and filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
