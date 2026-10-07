import type { ConsultationStatus } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { EmptyState, Skeleton } from '../ui/Card.js'
import { PageHeader } from '../ui/PageHeader.js'
import { Select } from '../ui/Select.js'
import { ConsultationRows } from './ConsultationRows.js'
import { StartConsultationDialog } from './StartConsultationDialog.js'

type ConsultationView = 'all' | 'draft' | 'awaiting_review' | 'approved'

const CATEGORY: Record<
  ConsultationView,
  { label: string; empty: string; matches: (status: ConsultationStatus) => boolean }
> = {
  all: {
    label: 'All',
    empty: 'No consultations yet.',
    matches: () => true,
  },
  draft: {
    label: 'Draft',
    empty: 'No drafts. Start a consultation to begin one.',
    matches: (status) => status === 'draft' || status === 'analyzing',
  },
  awaiting_review: {
    label: 'Awaiting Review',
    empty: 'Nothing is waiting for review.',
    matches: (status) => status === 'awaiting_review',
  },
  approved: {
    label: 'Approved',
    empty: 'No approved consultations yet.',
    matches: (status) => status === 'approved',
  },
}

const VIEW_OPTIONS = (Object.keys(CATEGORY) as ConsultationView[]).map((value) => ({
  value,
  label: CATEGORY[value].label,
}))

export function ConsultationList() {
  const { data, isPending } = useQuery({
    queryKey: ['consultations'],
    queryFn: api.listConsultations,
  })
  const [view, setView] = useState<ConsultationView>('awaiting_review')
  const startDialog = useRef<HTMLDialogElement>(null)

  const consultations = (data ?? []).filter((consultation) =>
    CATEGORY[view].matches(consultation.status),
  )

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Consultations"
        subtitle="Every visit you have recorded, from first capture to approved note."
        art="/art/consultations.webp"
        /*
         * Asks who the visit is for rather than navigating to the file room and
         * leaving the doctor to work that out. Starting from this list used to
         * produce a consultation belonging to nobody; linking to `/patients`
         * fixed the ownership but cost two more steps to get back here.
         */
        actions={
          <button
            type="button"
            onClick={() => startDialog.current?.showModal()}
            className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            New Consultation
          </button>
        }
      />

      <div data-print="hide" className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <Select
          label="Consultation View"
          value={view}
          options={VIEW_OPTIONS}
          className="w-52"
          onChange={(value) => {
            if (
              value !== 'all' &&
              value !== 'draft' &&
              value !== 'awaiting_review' &&
              value !== 'approved'
            )
              return
            setView(value)
          }}
        />
      </div>

      {/* Keyed by the view, so switching it starts from page one with nothing
        ticked: a selection made under one filter must not be erased under
        another, where some of it may no longer be on screen. */}
      <ConsultationRows key={view} consultations={consultations} tour="consultation-list">
        {isPending &&
          [0, 1, 2].map((key) => <Skeleton key={key} className="h-18 w-full rounded-card" />)}

        {data?.length === 0 && (
          <EmptyState
            title="No Consultations Yet"
            body="Consultations are filed to a patient. Start one and pick who it is for, or register them first."
            action={
              <button
                type="button"
                onClick={() => startDialog.current?.showModal()}
                className="mt-2 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Start A Consultation
              </button>
            }
          />
        )}

        {data && data.length > 0 && consultations.length === 0 && (
          <EmptyState title={CATEGORY[view].label} body={CATEGORY[view].empty} />
        )}
      </ConsultationRows>

      <StartConsultationDialog ref={startDialog} />
    </div>
  )
}
