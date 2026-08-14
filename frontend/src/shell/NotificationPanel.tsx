import type { NotificationAction, NotificationItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Sparkles, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Button } from '../ui/Button.js'
import { Skeleton } from '../ui/Card.js'

/**
 * How each notifiable audit action reads to a doctor.
 *
 * `linked: false` on `erased` is not cosmetic. The consultation is gone from
 * every read path the moment it is tombstoned, so a link would take someone to
 * a 404 they cannot act on. A notification that leads nowhere useful is worse
 * than one that is plainly terminal.
 */
const SHAPE: Record<
  NotificationAction,
  { label: string; icon: typeof CheckCircle2; tone: string; linked: boolean }
> = {
  'consultation.analysis_completed': {
    label: 'Analysis complete',
    icon: Sparkles,
    tone: 'text-accent',
    linked: true,
  },
  'consultation.analysis_failed': {
    label: 'Analysis failed',
    icon: CircleAlert,
    tone: 'text-emergency',
    linked: true,
  },
  'consultation.approved': {
    label: 'Note approved',
    icon: CheckCircle2,
    tone: 'text-accent',
    linked: true,
  },
  'consultation.erased': {
    label: 'Consultation erased',
    icon: Trash2,
    tone: 'text-ink-muted',
    linked: false,
  },
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const relative = new Intl.RelativeTimeFormat('en-MY', { numeric: 'auto' })

function ago(value: Date) {
  const elapsed = value.getTime() - Date.now()
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return relative.format(Math.round(elapsed / ms), unit)
  }
  return 'just now'
}

export function NotificationPanel({ onSeen, close }: { onSeen: () => void; close: () => void }) {
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
  })

  const clear = useMutation({
    mutationFn: api.clearNotifications,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // The panel is mounted only while it is open, so mounting *is* the doctor
  // having looked. No separate open callback, and no state in the parent that
  // can drift out of step with what is on screen.
  useEffect(onSeen, [onSeen])

  return (
    <div className="flex max-h-96 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 py-2 pr-2 pl-4">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {(data?.length ?? 0) > 0 && (
          <Button
            size="sm"
            variant="ghost"
            loading={clear.isPending}
            onClick={() => clear.mutate()}
            // "Clear", not "Delete". The rows are audit events and they survive
            // this: what changes is where this doctor's feed starts reading
            // from. Wording that promised deletion would be a lie about the one
            // table whose value is that nothing in it can be removed.
            title="Stop showing these. The audit record is kept."
          >
            Clear All
          </Button>
        )}
      </div>

      <div className="overflow-y-auto">
        {isPending && (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-10 w-full rounded-control" />
            ))}
          </div>
        )}

        {isError && (
          <p role="alert" className="px-4 py-6 text-center text-sm text-ink-muted">
            Notifications could not be loaded.
          </p>
        )}

        {data?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            Nothing yet. Analysed, approved and erased consultations show up here.
          </p>
        )}

        <ul>
          {data?.map((item) => (
            <NotificationRow key={item.id} item={item} close={close} />
          ))}
        </ul>
      </div>
    </div>
  )
}

function NotificationRow({ item, close }: { item: NotificationItem; close: () => void }) {
  const { label, icon: Icon, tone, linked } = SHAPE[item.action]

  const body = (
    <>
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="mt-0.5 block text-2xs text-ink-muted">
          {ago(item.createdAt)}
          {item.consultationId && (
            <span className="font-mono"> · {item.consultationId.slice(0, 8)}</span>
          )}
        </span>
      </span>
    </>
  )

  return (
    <li className="border-b border-line/60 last:border-0">
      {linked && item.consultationId ? (
        <Link
          to={`/consultations/${item.consultationId}`}
          onClick={close}
          className="flex gap-3 px-4 py-3 transition-colors hover:bg-sunken"
        >
          {body}
        </Link>
      ) : (
        <div className="flex gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  )
}
