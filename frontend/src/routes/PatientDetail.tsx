import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Card, EmptyState, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'
import { ConsultationRow } from './ConsultationRow.js'

const formatGender = (gender: 'male' | 'female' | 'other' | null) => {
  if (gender === null) return 'Not recorded'
  return gender.charAt(0).toUpperCase() + gender.slice(1)
}

export function PatientDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  /*
   * The record is created empty and the doctor is taken straight into it,
   * where capture happens. Assembling a transcript first and creating the
   * consultation afterwards is what the removed /consultations/new page did,
   * and it is why a visit could not be filed to a patient until the very end.
   */
  const start = useMutation({
    mutationFn: () => api.createConsultation(undefined, id),
    onSuccess: (consultation) => navigate(`/consultations/${consultation.id}`),
  })
  const patient = useQuery({
    queryKey: ['patient', id],
    queryFn: () => api.getPatient(id),
  })

  if (patient.isPending) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-38 w-full rounded-card" />
        <Skeleton className="h-44 w-full rounded-card" />
      </div>
    )
  }

  if (!patient.data) {
    return <p className="text-sm text-emergency">This patient record could not be loaded.</p>
  }

  const detail = patient.data
  const name = detail.name ?? 'Not recorded'

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Patient Profile"
        /*
         * No subtitle. It carried the raw cuid, which is meaningless to the
         * doctor reading it and looks like debug output on a clinical screen
         * (observed in production on 27/08/26). The patient card sits
         * immediately below and already names the patient, so repeating the
         * name here would trade one redundancy for another; the id stays in
         * the URL for anyone who needs it.
         */
        breadcrumb={
          <ol className="flex items-center gap-1.5">
            <li>
              <Link to="/patients" className="transition-colors hover:text-ink">
                Patients
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-ink">
              Profile
            </li>
          </ol>
        }
        art="/art/consultations.webp"
        actions={
          <button
            type="button"
            onClick={() => start.mutate()}
            className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            Start Consultation
          </button>
        }
      />

      <Card className="mt-6 p-6 sm:p-7" aria-label="Patient record">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Patient</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{name}</h2>
          </div>
          <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {detail.consultations.length} {detail.consultations.length === 1 ? 'Visit' : 'Visits'}
          </span>
        </div>

        <dl className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-ink-muted">NRIC</dt>
            <dd className="mt-1 text-sm font-medium">{detail.nric ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-muted">Age</dt>
            <dd className="mt-1 text-sm font-medium">
              {detail.age === null ? 'Not recorded' : `${detail.age} years`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-muted">Gender</dt>
            <dd className="mt-1 text-sm font-medium">{formatGender(detail.gender)}</dd>
          </div>
        </dl>
      </Card>

      <section className="mt-8" aria-labelledby="consultation-history-heading">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 id="consultation-history-heading" className="text-lg font-semibold">
              Consultation History
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Approved notes and ongoing consultations filed to this patient.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {detail.consultations.length === 0 ? (
            <EmptyState
              title="No Consultations Yet"
              body="Start a consultation from this profile to file it to the patient record."
              action={
                <button
                  type="button"
                  onClick={() => start.mutate()}
                  className="mt-2 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  Start Consultation
                </button>
              }
            />
          ) : (
            detail.consultations.map((consultation) => (
              <ConsultationRow key={consultation.id} consultation={consultation} />
            ))
          )}
        </div>
      </section>
    </div>
  )
}
