import type { ConsultationListItem, ConsultationStatus } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { EmptyState, Skeleton } from '../ui/Card.js'
import { Checkbox } from '../ui/Checkbox.js'
import { PageHeader } from '../ui/PageHeader.js'
import { Select } from '../ui/Select.js'
import { ConsultationRow } from './ConsultationRow.js'

const VIEW_OPTIONS = [
  { value: 'attention', label: 'Needs Attention' },
  { value: 'all', label: 'All Consultations' },
]

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

export function ConsultationList() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ['consultations'],
    queryFn: api.listConsultations,
  })
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<'attention' | 'all'>('attention')
  /**
   * Which row is open for renaming, owned here rather than inside the field.
   *
   * A row is a link, so the pencil has to sit outside the anchor to be its own
   * target, and it therefore cannot be the thing that holds the open state. One
   * id rather than a set, because two rows renaming at once is not a state a
   * doctor can be in.
   */
  const [renaming, setRenaming] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  // Associated explicitly rather than by wrapping. The input lives inside the
  // `Checkbox` component, so a wrapping label reads as having no control in it.
  const selectAllId = useId()

  const consultations =
    view === 'all'
      ? (data ?? [])
      : (data ?? []).filter(
          (consultation) =>
            consultation.status === 'draft' || consultation.status === 'awaiting_review',
        )

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

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) => api.patch(id, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consultations'] }),
    // Named rather than silent: a rename that failed leaves the old name on
    // screen, which is indistinguishable from one the doctor never made.
    onError: () => toast.error('That name could not be saved.'),
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
        /*
         * Points at the patient, because a visit is filed to one. Starting
         * from this list produced a consultation belonging to nobody.
         */
        actions={
          <Link
            to="/patients"
            className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-5 text-sm font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
          >
            <Plus aria-hidden className="size-4" />
            New Consultation
          </Link>
        }
      />

      <div data-print="hide" className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <Select
          label="Consultation View"
          value={view}
          options={VIEW_OPTIONS}
          className="w-52"
          onChange={(value) => {
            if (value !== 'attention' && value !== 'all') return
            setView(value)
            setPicked(new Set())
          }}
        />

        {consultations.length > 0 && (
          <div className="flex min-h-9 flex-1 items-center justify-end gap-4">
            <label
              htmlFor={selectAllId}
              className="flex cursor-pointer items-center gap-3 text-sm text-ink-muted"
            >
              <Checkbox
                id={selectAllId}
                checked={allSelected}
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
      </div>

      <div data-tour="consultation-list" className="mt-4 flex flex-col gap-2">
        {isPending &&
          [0, 1, 2].map((key) => <Skeleton key={key} className="h-18 w-full rounded-card" />)}

        {data?.length === 0 && (
          <EmptyState
            title="No Consultations Yet"
            body="Consultations are filed to a patient. Register one, then start the visit from their profile."
            action={
              <Link
                to="/patients"
                className="mt-2 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Go To Patients
              </Link>
            }
          />
        )}

        {data && data.length > 0 && consultations.length === 0 && (
          <EmptyState
            title="No Consultations Need Attention"
            body="Approved filing belongs on patient profiles. Show all consultations to view the complete record."
          />
        )}

        {consultations.map((consultation) => (
          <ConsultationRow
            key={consultation.id}
            consultation={consultation}
            selected={picked.has(consultation.id)}
            renaming={renaming === consultation.id}
            onSelect={() => toggle(consultation.id)}
            onBeginRename={() => setRenaming(consultation.id)}
            onRename={(title) => rename.mutate({ id: consultation.id, title })}
            onRenameDone={() => setRenaming(null)}
          />
        ))}
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
  const breakdown = (Object.keys(ERASE_NOUN) as ConsultationStatus[])
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
