import type { ConsultationListItem, ConsultationStatus } from '@shared/types'
import { Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../lib/cn.js'
import { Checkbox } from '../ui/Checkbox.js'
import { RenameField } from '../ui/RenameField.js'

const STATUS: Record<ConsultationStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'border-line text-ink-muted' },
  analyzing: { label: 'Analysing', className: 'border-advisory/40 text-advisory' },
  awaiting_review: { label: 'Awaiting Review', className: 'border-urgent/40 text-urgent' },
  approved: { label: 'Approved', className: 'border-accent/40 text-accent' },
}

export const formatConsultationDate = (value: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

export function ConsultationRow({
  consultation,
  selected = false,
  renaming = false,
  onSelect,
  onBeginRename,
  onRename,
  onRenameDone,
}: {
  consultation: ConsultationListItem
  selected?: boolean
  renaming?: boolean
  onSelect?: () => void
  onBeginRename?: () => void
  onRename?: (title: string | null) => void
  onRenameDone?: () => void
}) {
  const status = STATUS[consultation.status]
  const when = formatConsultationDate(consultation.createdAt)

  return (
    <div
      className={cn(
        'group/row flex items-center gap-3 rounded-card border bg-surface pl-4 transition-colors',
        selected ? 'border-accent/50 bg-accent-soft' : 'border-line hover:border-ink-muted/50',
      )}
    >
      {onSelect && (
        <Checkbox
          data-print="hide"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select consultation from ${when}`}
        />
      )}

      {renaming && onRename && onRenameDone ? (
        <RenameField
          defaultEditing
          value={consultation.title}
          fallback={when}
          label={`Rename the consultation from ${when}`}
          className="min-w-0 flex-1 py-3 pr-4"
          onDone={onRenameDone}
          onSave={onRename}
        />
      ) : (
        <Link
          to={`/consultations/${consultation.id}`}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 py-4 pr-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{consultation.title ?? when}</p>
            <p className="mt-0.5 truncate text-2xs text-ink-muted">
              <span className="font-mono">{consultation.id.slice(0, 8)}</span>
              {consultation.title === null ? null : ` · ${when}`}
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
      )}

      {!renaming && onBeginRename && (
        <button
          type="button"
          data-print="hide"
          aria-label={`Rename the consultation from ${when}`}
          onClick={onBeginRename}
          className="mr-3 flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted opacity-0 transition-opacity hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
        >
          <Pencil aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  )
}
