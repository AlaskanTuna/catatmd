import { DEMO_PLAN, ERASE_BATCH_LIMIT, type Fixture } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ApiError, api } from '../lib/api.js'
import { useTheme } from '../lib/theme.js'
import { Button } from '../ui/Button.js'
import { PageHeader } from '../ui/PageHeader.js'

const GUEST_EMAIL = 'guest@catatmd.demo'

/**
 * Account settings (PR #124).
 *
 * **There is deliberately no "reset to factory".** This app stores no
 * server-side preferences: `User` carries an identity and nothing else, and the
 * only thing a doctor has ever chosen is the theme, which lives in
 * `localStorage`. A button promising to reset settings would have exactly one
 * of them to reset, and would imply a preferences system that does not exist.
 * The theme control is right here instead, in the chrome, where it already was.
 *
 * What the page does carry is erasure, which is not a convenience feature.
 * `docs/dpia.md` lists the data-subject erasure right under "Retention,
 * Deletion, And Access Requests" as designed but unimplemented; this is the
 * implementation.
 */
export function Settings() {
  const queryClient = useQueryClient()
  const { resolved, setPreference } = useTheme()
  const dialog = useRef<HTMLDialogElement>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const session = useQuery({ queryKey: ['session'], queryFn: api.session, retry: false })
  const consultations = useQuery({ queryKey: ['consultations'], queryFn: api.listConsultations })
  const fixtures = useQuery({ queryKey: ['fixtures'], queryFn: api.fixtures })

  const isGuest = session.data?.user.email === GUEST_EMAIL
  const owned = consultations.data ?? []

  const wipe = useMutation({
    mutationFn: async () => {
      const ids = owned.map((c) => c.id)
      let erased = 0

      // Chunked because the erase endpoint is bounded, and sequential because
      // each erasure appends to the audit hash chain, whose head cannot be
      // raced. Same reasoning as the batch route itself.
      for (let i = 0; i < ids.length; i += ERASE_BATCH_LIMIT) {
        setProgress(`Erasing ${erased + 1} of ${ids.length}`)
        const result = await api.eraseConsultations(ids.slice(i, i + ERASE_BATCH_LIMIT))
        erased += result.erased.length
      }

      if (isGuest) await reseed(fixtures.data ?? [], setProgress)
      return erased
    },
    onSuccess: (erased) => {
      setProgress(null)
      dialog.current?.close()
      toast.success(
        isGuest
          ? `${erased} erased, and the demo account has been rebuilt.`
          : `${erased} consultation${erased === 1 ? '' : 's'} erased.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      return queryClient.invalidateQueries({ queryKey: ['consultations'] })
    },
    onError: () => setProgress(null),
  })

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" subtitle="Appearance and your data." art="/art/settings.webp" />

      <section className="mt-8 rounded-card border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Stored in this browser only, and never sent to the server.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant={resolved === 'light' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPreference('light')}
          >
            Light
          </Button>
          <Button
            variant={resolved === 'dark' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPreference('dark')}
          >
            Dark
          </Button>
        </div>
      </section>

      <section className="mt-5 rounded-card border border-emergency/30 bg-surface p-5">
        <h2 className="text-base font-semibold">Delete My Data</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">
          Permanently erases the clinical content of every consultation on this account, currently{' '}
          {owned.length}. That is the transcript, the analysis, and any edits made to the note. It
          cannot be undone.
        </p>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
          A record that each consultation existed and was erased is kept, and cannot be removed.
          That record is what makes the erasure provable; it holds no clinical content.
        </p>
        {isGuest && (
          <p className="mt-3 max-w-prose rounded-control border border-urgent/40 bg-urgent/8 px-3 py-2 text-sm">
            This is the shared demo account, so it will be rebuilt afterwards from the bundled
            synthetic cases. That runs the real analysis pipeline and takes a few minutes.
          </p>
        )}
        <Button
          variant="danger"
          size="sm"
          className="mt-4"
          icon={<Trash2 aria-hidden className="size-3.5" />}
          disabled={owned.length === 0 && !isGuest}
          onClick={() => {
            wipe.reset()
            dialog.current?.showModal()
          }}
        >
          Delete My Data
        </Button>
      </section>

      <dialog
        ref={dialog}
        data-print="hide"
        aria-labelledby="wipe-title"
        className="glass-panel m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-float p-0 text-ink backdrop:bg-scrim backdrop:backdrop-blur-sm"
      >
        <div className="p-6">
          <h2 id="wipe-title" className="text-lg font-semibold">
            Erase everything on this account?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {owned.length} consultation{owned.length === 1 ? '' : 's'} will be erased.
            {isGuest
              ? ' The demo account will then be rebuilt from the bundled synthetic cases, which spends a real analysis for each one.'
              : ' Their clinical content goes permanently; the audit record that they existed stays.'}
          </p>
          <p className="mt-2 text-sm font-medium">This cannot be undone.</p>

          {progress && (
            <p role="status" className="mt-3 text-sm text-ink-muted">
              {progress}
            </p>
          )}
          {wipe.error != null && (
            <p role="alert" className="mt-3 text-sm text-emergency">
              {wipe.error instanceof ApiError ? wipe.error.message : 'Nothing was erased.'}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => dialog.current?.close()} disabled={wipe.isPending}>
              Cancel
            </Button>
            <Button variant="danger" loading={wipe.isPending} onClick={() => wipe.mutate()}>
              Erase Everything
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  )
}

/**
 * Rebuilds the shared demo account by driving the same endpoints a doctor would.
 *
 * **From the browser, one request at a time, deliberately.** Rebuilding runs a
 * full analysis per fixture, which is minutes of model time in total. A single
 * server-side request doing that would sit far past the edge timeout in front
 * of the API, and there is no queue or worker to hand it to. Driving it from
 * here keeps every request short, makes the progress observable, and adds no
 * infrastructure. `prisma/seed-demo.ts` already works exactly this way over
 * HTTP; `DEMO_PLAN` is shared so the two cannot drift.
 */
async function reseed(fixtures: Fixture[], onProgress: (message: string) => void) {
  for (const [index, step] of DEMO_PLAN.entries()) {
    const fixture = fixtures.find((f) => f.id === step.fixtureId)
    if (!fixture) continue

    onProgress(`Rebuilding ${index + 1} of ${DEMO_PLAN.length}`)
    const created = await api.createConsultation(fixture.transcript)
    if (step.target === 'draft') continue

    const analysed = await api.analyze(created.id)
    if (step.target === 'approved' && analysed.analysis) await api.approve(created.id)
  }
}
