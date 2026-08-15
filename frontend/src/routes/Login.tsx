import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileLock2, MapPin, UserCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { Button } from '../ui/Button.js'
import { Mark } from '../ui/Mark.js'
import { ThemeToggle } from '../ui/ThemeToggle.js'
import { Wordmark } from '../ui/Wordmark.js'

/**
 * Guest sign-in carries no credentials, by design (#29).
 *
 * The demo account's password is held server-side and exchanged at
 * `POST /api/auth/guest`. Putting it in a form here, even prefilled, would ship
 * it in the JavaScript bundle, which is not "environment configuration" in any
 * useful sense. So the guest path is a button that posts an empty body, and the
 * doctor types nothing.
 */
const CLAIMS = [
  { Icon: FileLock2, text: 'Identifiers are replaced with tokens before any text reaches a model' },
  { Icon: UserCheck, text: 'Nothing is finalised without the treating doctor approving it' },
  { Icon: MapPin, text: 'Application, API and database are all hosted locally' },
]

export function Login() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const [sessionBlocked, setSessionBlocked] = useState(false)

  /**
   * Fetched rather than invalidated, because a sign-in can return 200 and still
   * leave no readable session: if the browser discards the cookie, navigating
   * lands on `RequireSession`, which bounces straight back here with nothing on
   * screen to explain it. Reading the session first turns that silent loop into
   * a stated reason (#156).
   */
  const onSuccess = async () => {
    setSessionBlocked(false)
    const session = await queryClient.fetchQuery({ queryKey: ['session'], queryFn: api.session })
    if (!session) {
      setSessionBlocked(true)
      return
    }
    navigate('/consultations')
  }

  const guest = useMutation({ mutationFn: api.signInGuest, onSuccess })
  const credentials = useMutation({
    mutationFn: () =>
      mode === 'signin' ? api.signIn(email, password) : api.signUp(email, password, name),
    onSuccess,
  })

  const pending = guest.isPending || credentials.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    credentials.mutate()
  }

  return (
    <div className="flex min-h-dvh">
      {/*
        The brand pane carries the three architectural claims rather than
        decoration. The research is explicit that Malaysian clinical audiences
        expect visible credentials and that Western clinician products express
        them with restraint, so this is the credential row given room, not a
        gradient with a logo on it.
      */}
      <aside className="relative hidden w-1/2 flex-col justify-between bg-accent p-10 lg:flex">
        <Link to="/" className="flex items-center gap-2.5 text-accent-ink">
          <Mark className="size-6" />
          <Wordmark tone="inverse" className="text-xl" />
        </Link>

        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug tracking-tight text-accent-ink">
            The consultation is already documented. It just needs you to check it.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {CLAIMS.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0 text-accent-ink/70" />
                <span className="text-sm leading-relaxed text-accent-ink/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center justify-between px-6 py-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-base font-semibold tracking-tight lg:invisible"
          >
            <Mark className="size-6 text-accent" />
            <Wordmark className="text-lg" />
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">
              {mode === 'signin' ? 'Sign In' : 'Create an Account'}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              All consultations in this prototype are simulated. No real patient data.
            </p>

            {/* Not attached to either sign-in path, because it is neither's
                fault: the credential was accepted and the browser dropped the
                cookie afterwards. */}
            {sessionBlocked && (
              <p
                role="alert"
                className="mt-6 rounded-control bg-emergency/10 p-3 text-sm text-emergency"
              >
                Signed in, but your browser did not keep the session. This usually means cookies are
                blocked for this site. Enable them and try again.
              </p>
            )}

            <Button
              variant="primary"
              size="lg"
              className="mt-6 w-full"
              loading={guest.isPending}
              disabled={pending}
              onClick={() => guest.mutate()}
            >
              Sign In as Guest
            </Button>
            {/* Beside the button that raised it. It used to render inside the
                credentials form below, far enough from the guest button that a
                failed guest sign-in read as nothing happening at all. */}
            {guest.error && (
              <p role="alert" className="mt-2 text-sm text-emergency">
                {guest.error instanceof ApiError
                  ? guest.error.message
                  : 'Guest sign in failed. Please try again.'}
              </p>
            )}

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs text-ink-muted">or use an account</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              {mode === 'signup' && (
                <Field label="Name" value={name} onChange={setName} autoComplete="name" required />
              )}
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                required
              />
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />

              {credentials.error && (
                <p role="alert" className="text-sm text-emergency">
                  {credentials.error instanceof ApiError
                    ? credentials.error.message
                    : 'Sign in failed. Please try again.'}
                </p>
              )}

              <Button
                type="submit"
                className="mt-1 w-full"
                loading={credentials.isPending}
                disabled={pending}
              >
                {mode === 'signin' ? 'Sign In' : 'Create Account'}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              className="mt-4 text-sm font-medium text-accent underline underline-offset-2"
            >
              {mode === 'signin' ? 'Create an account instead' : 'I already have an account'}
            </button>

            <p className="mt-8 text-xs text-ink-muted">
              By signing in you accept that this is an evaluation prototype.{' '}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">
                Privacy and Data Protection
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-control border border-line bg-surface px-3 text-sm transition-colors focus:border-accent"
        {...props}
      />
    </label>
  )
}
