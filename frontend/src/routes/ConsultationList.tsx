import type { ConsultationListItem, ConsultationStatus } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { cn } from '../lib/cn.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { EmptyState, Skeleton } from '../ui/Card.js'
import { Checkbox } from '../ui/Checkbox.js'
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

/**
 * How each status is named when counted in the erase confirmation.
 *
 * Separate from `STATUS.label` because these are read as nouns inside a
 * sentence ("1 approved note") rather than as a chip on a row, and because the
 * approved wording is the one a doctor most needs to register before agreeing.
 */
const ERASE_NOUN: Record<ConsultationStatus, { one: string; many: string }> = {
  draft: { one: 'draft', many: 'drafts' },
  analyzing: { one: 'consultation being analysed', many: 'consultations being analysed' },
  awaiting_review: { one: 'consultation awaiting review', many: 'consultations awaiting review' },
  approved: { one: 'approved note', many: 'approved notes' },
}

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

export function ConsultationList() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ['consultations'],
    queryFn: api.listConsultations,
  })
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const dialog = useRef<HTMLDialogElement>(null)
  // Associated explicitly rather than by wrapping. The input lives inside the
  // `Checkbox` component, so a wrapping label reads as having no control in it.
  const selectAllId = useId()

  const consultations = data ?? []

  // Derived from the rows rather than read straight out of state, so a
  // selection cannot outlive the consultation it points at. Without this, a
  // list that refreshed while the dialog was open could erase by an id the
  // doctor could no longer see.
  const selected = consultations.filter((c) => picked.has(c.id))
  const allSelected = consultations.length > 0 && selected.length === consultations.length

  const erase = useMutation({
    mutationFn: () => api.eraseConsultations(selected.map((c) => c.id)),
    onSuccess: ({ erased, failed }) => {
      dialog.current?.close()
      setPicked(new Set())
      // A partial failure is an error even though the request succeeded, and it
      // gets the longer error duration, because "some of what you asked for did
      // not happen" is the one outcome here a doctor may need to act on.
      if (failed.length > 0) {
        toast.error(
          `${count(erased.length, 'consultation')} erased. ${count(failed.length, 'other')} could not be, and may already have been erased elsewhere.`,
        )
      } else {
        toast.success(`${count(erased.length, 'consultation')} erased.`)
      }
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      return queryClient.invalidateQueries({ queryKey: ['consultations'] })
    },
  })

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
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
            className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            New Consultation
          </Link>
        }
      />

      {consultations.length > 0 && (
        <div data-print="hide" className="mt-8 flex min-h-9 items-center justify-between gap-4">
          <label
            htmlFor={selectAllId}
            className="flex cursor-pointer items-center gap-3 text-sm text-ink-muted"
          >
            <Checkbox
              id={selectAllId}
              checked={allSelected}
              // A DOM property rather than an attribute: there is no
              // `indeterminate` in HTML, only on the element.
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && !allSelected
              }}
              onChange={() =>
                setPicked(allSelected ? new Set() : new Set(consultations.map((c) => c.id)))
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
      )}

      <div data-tour="consultation-list" className="mt-4 flex flex-col gap-2">
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

        {consultations.map((consultation) => {
          const status = STATUS[consultation.status]
          const when = formatDate(consultation.createdAt)
          return (
            <div
              key={consultation.id}
              className={cn(
                'flex items-center gap-3 rounded-card border bg-surface pl-4 transition-colors',
                // The tint is a layer over the surface, not a replacement for
                // it: as a `background-color` it won the cascade and left the
                // row translucent over the page's dot grid.
                picked.has(consultation.id)
                  ? 'border-accent/50 bg-linear-to-r from-accent/8 to-accent/8'
                  : 'border-line hover:border-ink-muted/50',
              )}
            >
              {/* A sibling of the link, never a child of it: a control nested
                  inside an anchor is not reachable as its own target. */}
              <Checkbox
                data-print="hide"
                checked={picked.has(consultation.id)}
                onChange={() => toggle(consultation.id)}
                aria-label={`Select consultation from ${when}`}
              />
              <Link
                to={`/consultations/${consultation.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-4 py-4 pr-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{when}</p>
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
            </div>
          )
        })}
      </div>

      <EraseDialog
        ref={dialog}
        selected={selected}
        pending={erase.isPending}
        error={erase.error}
        onConfirm={() => erase.mutate()}
      />
    </div>
  )
}

/**
 * The confirmation, and the one place the system is honest about what erasure
 * actually is.
 *
 * It says "erased", not "deleted", because the row does not go.
 * `eraseConsultation` nulls the clinical columns and stamps `erasedAt`, while
 * the audit chain that references the consultation stays intact. Calling that a
 * delete would be a comfortable lie in a product whose whole claim is a
 * tamper-evident record.
 *
 * The status breakdown exists so the weight of the selection is visible at the
 * moment of the decision. Approved notes are erasable, which is deliberate and
 * follows docs/dpia.md: erasure serves a data-subject right that does not lapse
 * because a doctor signed the note. But a doctor about to erase one should not
 * discover that afterwards.
 *
 * A native <dialog>, for the same reason as the tour's: focus trapping, Escape
 * and inertness of the page behind it, none of them hand-rolled. It is glass
 * over the scrim, matching every other floating surface; the text on it stays
 * at full-strength ink because a destructive confirmation is the last place to
 * trade contrast for texture.
 */
function EraseDialog({
  ref,
  selected,
  pending,
  error,
  onConfirm,
}: {
  ref: React.Ref<HTMLDialogElement>
  selected: ConsultationListItem[]
  pending: boolean
  error: unknown
  onConfirm: () => void
}) {
  // Ordered by `STATUS`, so the heaviest line lands last.
  const breakdown = (Object.keys(STATUS) as ConsultationStatus[])
    .map((status) => ({ status, n: selected.filter((c) => c.status === status).length }))
    .filter(({ n }) => n > 0)

  const close = () => (ref as React.RefObject<HTMLDialogElement | null>).current?.close()

  return (
    <dialog
      ref={ref}
      data-print="hide"
      aria-labelledby="erase-title"
      className="glass-panel m-auto w-[26rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id="erase-title" className="text-lg font-semibold">
          Erase {count(selected.length, 'consultation')}?
        </h2>

        <ul className="mt-4 flex flex-col gap-1 text-sm">
          {breakdown.map(({ status, n }) => (
            <li
              key={status}
              // Approved is the line that changes the decision, so it is the one
              // that is coloured. It still says the word, because colour is
              // never the only carrier of a meaning here (issue #30).
              className={status === 'approved' ? 'font-medium text-urgent' : 'text-ink-muted'}
            >
              {n} {n === 1 ? ERASE_NOUN[status].one : ERASE_NOUN[status].many}
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          The transcript, analysis and edited note are permanently erased. A tamper-evident audit
          record that the consultation existed and was erased is retained, and cannot be removed.
        </p>
        <p className="mt-2 text-sm font-medium">This cannot be undone.</p>

        {error != null && (
          <p role="alert" className="mt-3 text-sm text-emergency">
            {error instanceof ApiError ? error.message : 'Nothing was erased. Please try again.'}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            Erase {selected.length}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
