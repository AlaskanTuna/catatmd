import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useTheme } from '../lib/theme.js'
import { Button } from '../ui/Button.js'
import { Dropover } from './Dropover.js'
import { NotificationPanel } from './NotificationPanel.js'

/**
 * The signed-in chrome that is not navigation: theme, notifications, account
 * (issue #116).
 *
 * One cluster rather than three floating buttons. They are a single group to a
 * keyboard user, a single thing to hide when printing, and a single surface to
 * keep clear of the tour FAB in the opposite corner. Three separate circles
 * would also have read as three primary actions, which is what a FAB means and
 * none of these are.
 *
 * The theme control moved here from `SidebarIsland` and `MobileDock` rather
 * than being added alongside them: two switches for one setting is a bug that
 * takes a while to notice.
 *
 * The top offset is driven by `--live-banner-inset`, which only the dev-only
 * live-data banner ever sets. Production never defines it, so the fallback of
 * zero is what ships, and this file needs no knowledge of that banner.
 */
export function ChromeCluster() {
  const { resolved, setPreference } = useTheme()
  const [seenAt, setSeenAt] = useState<number | null>(null)

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    retry: false,
  })

  // Everything is unread until the panel has been opened once this session.
  // A bell that starts empty on every load is a bell with nothing to say.
  const unread = (notifications.data ?? []).filter(
    (item) => seenAt === null || item.createdAt.getTime() > seenAt,
  ).length

  const markSeen = useCallback(() => setSeenAt(Date.now()), [])

  return (
    <div
      data-print="hide"
      style={{ zIndex: 'var(--z-sidebar)', top: 'calc(0.75rem + var(--live-banner-inset, 0px))' }}
      className="glass fixed right-4 flex items-center gap-1 rounded-float p-1.5 md:right-6"
    >
      <button
        type="button"
        onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
        aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={resolved === 'dark' ? 'Light Theme' : 'Dark Theme'}
        className="flex size-9 items-center justify-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-sunken/60 hover:text-ink"
      >
        {resolved === 'dark' ? (
          <Sun aria-hidden className="size-4.5" />
        ) : (
          <Moon aria-hidden className="size-4.5" />
        )}
      </button>

      <Dropover
        label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        icon={<Bell aria-hidden className="size-4.5" />}
        badge={unread}
      >
        {(close) => <NotificationPanel onSeen={markSeen} close={close} />}
      </Dropover>

      <Dropover label="Account" icon={<UserRound aria-hidden className="size-4.5" />}>
        {() => <AccountPanel />}
      </Dropover>
    </div>
  )
}

function AccountPanel() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, retry: false })

  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: async () => {
      // Cleared, not just invalidated. The cache holds consultations, notes and
      // analyses; leaving them in memory for whoever signs in next on this
      // device would undo the sign-out it is meant to complete.
      queryClient.clear()
      await navigate('/login')
    },
  })

  return (
    <div className="p-4">
      {session.data?.user ? (
        <>
          <p className="truncate text-sm font-medium">{session.data.user.name}</p>
          <p className="mt-0.5 truncate text-2xs text-ink-muted">{session.data.user.email}</p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">Signed in.</p>
      )}

      <Button
        size="sm"
        variant="secondary"
        icon={<LogOut aria-hidden className="size-3.5" />}
        loading={signOut.isPending}
        onClick={() => signOut.mutate()}
        className="mt-4 w-full"
      >
        Sign Out
      </Button>

      {signOut.error != null && (
        <p role="alert" className="mt-2 text-2xs text-emergency">
          Sign out failed. Please try again.
        </p>
      )}
    </div>
  )
}
