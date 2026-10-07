import type { ConsultationListItem, ConsultationStatus } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ApiError, api } from '../lib/api.js'
import { count } from '../lib/plural.js'
import { Button } from '../ui/Button.js'
import { clampPage, Pagination, paginate } from '../ui/Pagination.js'
import { SelectionIsland } from '../ui/SelectionIsland.js'
import { ConsultationRow } from './ConsultationRow.js'

export const CONSULTATION_PAGE_SIZE = 15

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

/**
 * A list of consultations with everything a doctor does to one: open it,
 * rename it, tick it, erase a selection, and page through more than fifteen.
 *
 * One component for the in-tray at `/consultations` and the history on a
 * patient's profile, which had drifted apart: the profile listed every visit
 * on one page with no way to rename or erase from it. A row is a row.
 *
 * `children` renders above the rows inside the same column, for the caller's
 * skeletons and empty states. Remount it with a `key` to reset the page and
 * the selection when the caller's filter changes.
 */
export function ConsultationRows({
  consultations,
  showPatient = true,
  tour,
  children,
}: {
  /** Already filtered to what the caller is showing. */
  consultations: ConsultationListItem[]
  /** Off on a patient's own profile, where every row would name the same person. */
  showPatient?: boolean
  tour?: string
  children?: ReactNode
}) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [page, setPage] = useState(1)
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
  const list = useRef<HTMLDivElement>(null)

  const pageCount = Math.ceil(consultations.length / CONSULTATION_PAGE_SIZE)
  // `page` is what was last asked for; `currentPage` is what still exists.
  // Erasing rows can shrink the list out from under a page number, and
  // rendering an empty page is the failure the clamp is there to avoid.
  const currentPage = clampPage(page, pageCount)
  // Written back, so a list that later grows again stays where the doctor
  // last was rather than jumping to the page the stale number still names.
  if (currentPage !== page) setPage(currentPage)
  const pageRows = paginate(consultations, currentPage, CONSULTATION_PAGE_SIZE)

  // Derived from the rows rather than read straight out of state, so a
  // selection cannot outlive the consultation it points at. Without this, a
  // list that refreshed while the dialog was open could erase by an id the
  // doctor could no longer see.
  const selected = consultations.filter((c) => picked.has(c.id))

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
      void queryClient.invalidateQueries({ queryKey: ['patients'] })
      void queryClient.invalidateQueries({ queryKey: ['patient'] })
      return queryClient.invalidateQueries({ queryKey: ['consultations'] })
    },
  })

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) => api.patch(id, { title }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['patient'] })
      return queryClient.invalidateQueries({ queryKey: ['consultations'] })
    },
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
    <>
      <div ref={list} data-tour={tour} className="mt-4 flex flex-col gap-2">
        {children}

        {pageRows.map((consultation) => (
          <ConsultationRow
            key={consultation.id}
            consultation={consultation}
            showPatient={showPatient}
            selected={picked.has(consultation.id)}
            renaming={renaming === consultation.id}
            onSelect={() => toggle(consultation.id)}
            onBeginRename={() => setRenaming(consultation.id)}
            onRename={(title) => rename.mutate({ id: consultation.id, title })}
            onRenameDone={() => setRenaming(null)}
          />
        ))}
      </div>

      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />

      <SelectionIsland
        count={selected.length}
        total={consultations.length}
        noun={{ one: 'consultation', many: 'consultations' }}
        list={list}
        onSelectAll={() => setPicked(new Set(consultations.map((c) => c.id)))}
        onClear={() => setPicked(new Set())}
        onErase={() => {
          erase.reset()
          dialog.current?.showModal()
        }}
      />

      <EraseDialog
        ref={dialog}
        selected={selected}
        pending={erase.isPending}
        error={erase.error}
        onConfirm={() => erase.mutate()}
      />
    </>
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
