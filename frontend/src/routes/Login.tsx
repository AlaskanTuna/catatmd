import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Stethoscope } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.js'
import { Button } from '../ui/Button.js'

/**
 * Guest sign-in carries no credentials, by design (#29).
 *
 * The demo account's password is held server-side and exchanged at
 * `POST /api/auth/guest`. Putting it in a form here, even prefilled, would ship
 * it in the JavaScript bundle, which is not "environment configuration" in any
 * useful sense. So the guest path is a button that posts an empty body, and the
 * doctor types nothing.
 */
export function Login() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    navigate('/consultations')
  }

  const guest = useMutation({ mutationFn: api.signInGuest, onSuccess })
  const credentials = useMutation({
    mutationFn: () =>
      mode === 'signin' ? api.signIn(email, password) : api.signUp(email, password, name),
    onSuccess,
  })

  const error = guest.error ?? credentials.error
  const pending = guest.isPending || credentials.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    credentials.mutate()
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Stethoscope aria-hidden className="size-5 text-accent" />
          CatatMD
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          {mode === 'signin' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          All consultations in this prototype are simulated. No real patient data.
        </p>

        <Button
          variant="primary"
          size="lg"
          className="mt-6 w-full"
          loading={guest.isPending}
          disabled={pending}
          onClick={() => guest.mutate()}
        >
          Sign in as Guest
        </Button>
        {/* The shared-account risk was raised and explicitly accepted
            (13/08/26). Stating it here is the condition of that acceptance. */}
        <p className="mt-2 text-xs text-ink-muted">
          A shared demo account. Other guests signed in at the same time will see the same
          consultations.
        </p>

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

          {error && (
            <p role="alert" className="text-sm text-emergency">
              {error instanceof ApiError ? error.message : 'Sign in failed. Please try again.'}
            </p>
          )}

          <Button
            type="submit"
            className="mt-1 w-full"
            loading={credentials.isPending}
            disabled={pending}
          >
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-4 text-sm font-medium text-accent underline underline-offset-2"
        >
          {mode === 'signin' ? 'Create an account instead' : 'I already have an account'}
        </button>
      </div>
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
        className="h-10 rounded-[--radius-control] border border-line bg-surface px-3 text-sm transition-colors focus:border-accent"
        {...props}
      />
    </label>
  )
}
