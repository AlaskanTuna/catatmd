import type { ConsultationStatus } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { EmptyState, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'

/**
 * Status is carried by colour, shape and a word together, never colour alone
 * (issue #30). `approved` is the only one that earns the accent, because
 * approval is the only state a human deliberately caused.
 */
const STATUS: Record<ConsultationStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-line text-ink-muted' },
  analyzing: { label: 'Analysing', className: 'border-advisory/40 text-advisory' },
  awaiting_review: { label: 'Awaiting Review', className: 'border-urgent/40 text-urgent' },
  approved: { label: 'Approved', className: 'border-accent/40 text-accent' },
}

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

export function ConsultationList() {
  const { data, isPending } = useQuery({
    queryKey: ['consultations'],
    queryFn: api.listConsultations,
  })

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Consultations"
        subtitle="Simulated consultations, scoped to you."
        art="/art/consultations.webp"
        actions={
          <Link
            to="/consultations/new"
            className="inline-flex h-10 items-center gap-2 rounded-pill bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            New Consultation
          </Link>
        }
      />

      <div className="mt-8 flex flex-col gap-2">
        {isPending &&
          [0, 1, 2].map((key) => <Skeleton key={key} className="h-18 w-full rounded-card" />)}

        {data?.length === 0 && (
          <EmptyState
            title="No Consultations Yet"
            body="Start one from a bundled synthetic case, or paste a transcript you already have."
            action={
              <Link
                to="/consultations/new"
                className="mt-2 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Start a Consultation
              </Link>
            }
          />
        )}

        {data?.map((consultation) => {
          const status = STATUS[consultation.status]
          return (
            <Link
              key={consultation.id}
              to={`/consultations/${consultation.id}`}
              className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-4 py-4 transition-colors hover:border-ink-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{formatDate(consultation.createdAt)}</p>
                <p className="mt-0.5 font-mono text-2xs text-ink-muted">
                  {consultation.id.slice(0, 8)}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-2xs font-medium',
                  status.className,
                )}
              >
                {status.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
