import { type CreatePatientInput, CreatePatientInputSchema } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { Button } from '../ui/Button.js'
import { Card } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'
import { Select } from '../ui/Select.js'

const GENDER_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
]

export function PatientNew() {
  const navigate = useNavigate()
  const submitting = useRef(false)
  const [name, setName] = useState('')
  const [nric, setNric] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (input: CreatePatientInput) => api.createPatient(input),
    onSuccess: (patient) => navigate(`/patients/${patient.id}`),
    onSettled: () => {
      submitting.current = false
    },
  })

  const register = () => {
    if (submitting.current) return
    setValidationError(null)
    const trimmedName = name.trim()
    const trimmedNric = nric.trim()
    const candidate = {
      name: trimmedName,
      ...(trimmedNric ? { nric: trimmedNric } : {}),
      ...(age ? { age: Number(age) } : {}),
      ...(gender ? { gender } : {}),
    }
    const parsed = CreatePatientInputSchema.safeParse(candidate)

    if (!parsed.success) {
      setValidationError(
        trimmedName === '' ? 'Enter the patient name.' : 'Check the patient details and try again.',
      )
      return
    }

    submitting.current = true
    create.mutate(parsed.data)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    register()
  }

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    register()
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Register Patient"
        subtitle="Create the filing record first, then start the consultation from the patient profile."
        breadcrumb={
          <ol className="flex items-center gap-1.5">
            <li>
              <Link to="/patients" className="transition-colors hover:text-ink">
                Patients
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-ink">
              Register
            </li>
          </ol>
        }
        art="/art/consultations.webp"
      />

      <Card className="mt-6 p-6 sm:p-8">
        <form noValidate autoComplete="off" onSubmit={submit} className="flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-semibold">Patient Details</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Only the patient name is required. Add the rest when it is available.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <input
              // biome-ignore lint/a11y/noAutofocus: Reception opens this single-step form ready for immediate entry.
              autoFocus
              required
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={submitOnEnter}
              className="h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent"
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">NRIC</span>
              <input
                autoComplete="off"
                value={nric}
                onChange={(event) => setNric(event.target.value)}
                onKeyDown={submitOnEnter}
                className="h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Age</span>
              <input
                type="number"
                min={0}
                max={130}
                step={1}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                onKeyDown={submitOnEnter}
                className="h-11 rounded-control border border-line bg-surface px-3.5 text-sm transition-colors hover:border-accent focus:border-accent"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5 sm:max-w-[calc(50%-0.625rem)]">
            <span className="text-sm font-medium">Gender</span>
            <Select label="Gender" value={gender} options={GENDER_OPTIONS} onChange={setGender} />
          </div>

          {(validationError || create.error) && (
            <p role="alert" className="text-sm text-emergency">
              {validationError ??
                (create.error instanceof ApiError
                  ? create.error.message
                  : 'The patient could not be registered. Try again.')}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-5">
            <Link
              to="/patients"
              className="inline-flex h-10 items-center justify-center rounded-control border border-line bg-sunken-soft px-4 text-sm font-medium text-ink shadow-raised transition-colors hover:bg-sunken"
            >
              Cancel
            </Link>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Register Patient
            </Button>
          </div>
        </form>
      </Card>

      {/*
        The wrong-turn exit. Registering and finding are the two halves of the
        same question, and someone who arrived here for a patient who already
        exists would otherwise have to guess at the navigation. Quiet, and
        below the card rather than inside it, so it never competes with the
        submit it sits under.
      */}
      <p className="mt-4 text-center text-sm text-ink-muted">
        Looking for an existing patient?{' '}
        <Link
          to="/patients"
          className="rounded-control font-medium text-accent underline-offset-4 transition-colors hover:underline"
        >
          Head to the patient records
        </Link>
        .
      </p>
    </div>
  )
}
