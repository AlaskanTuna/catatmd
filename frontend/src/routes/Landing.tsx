import { ArrowRight, FileLock2, MapPin, Stethoscope, UserCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Mark } from '../ui/Mark.js'
import { ThemeToggle } from '../ui/ThemeToggle.js'
import { Wordmark } from '../ui/Wordmark.js'

/**
 * The only brand-register surface in the product, and the first thing an
 * evaluator sees.
 *
 * The research (`docs/superpowers/research/09-medical-web-design.md`) is
 * specific about what belongs here: Malaysian clinical audiences expect
 * explicit credentials, Western clinician products express them with
 * restraint, and CatatMD's audience is Malaysian doctors. So the hero states
 * the three architectural claims as plain facts rather than as badges, and
 * there is no metric grid, no logo strip, and no gradient anywhere.
 *
 * What it must not do is oversell. Every differentiator this product has is a
 * claim of discipline, and a loud landing page argues against all of them.
 */
const CLAIMS = [
  {
    Icon: FileLock2,
    title: 'Identifiers Never Reach the Model',
    body: 'Every outbound call passes a de-identification gate first. Names and NRICs are replaced with pseudonymous tokens and restored only after the response returns.',
  },
  {
    Icon: Stethoscope,
    title: 'Red Flags Are Deterministic',
    body: 'Escalation triggers run as code against a versioned list. The model may add candidates for review; it can never suppress or downgrade a rule that fired.',
  },
  {
    Icon: UserCheck,
    title: 'The Doctor Approves Everything',
    body: 'Nothing is finalised without an explicit action. The system does not diagnose, and every note is edited and signed off by the treating clinician.',
  },
]

export function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2">
          <Mark className="size-6 text-accent" />
          <Wordmark className="text-xl" />
        </span>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link
            to="/login"
            className="rounded-[--radius-control] px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-sunken"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-14 sm:py-20">
          <p className="text-sm font-medium text-accent">
            Prototype · adult upper respiratory consultations
          </p>
          {/* Fixed rem, not clamp. The ceiling stays well under the 6rem
              shouting line, and the copy is tested at every breakpoint so a
              long word cannot overflow a narrow column. */}
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-[2.75rem]">
            The consultation is already documented. It just needs you to check it.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            CatatMD turns a GP consultation transcript into a structured clinical note, tells you
            what the consultation did not establish, and shows its working. You review, edit, and
            approve. It does not diagnose.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              className="inline-flex h-12 items-center gap-2 rounded-[--radius-control] bg-accent px-6 text-base font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Try the Demo
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <MapPin aria-hidden className="size-4" />
              Hosted in Singapore
            </span>
          </div>
        </section>

        <section aria-labelledby="claims" className="border-t border-line py-14">
          <h2 id="claims" className="text-xl font-semibold tracking-tight">
            Three Things This Product Does Differently
          </h2>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Each one is an architectural property rather than a policy, which means it holds whether
            or not the model behaves.
          </p>
          {/* Not an identical card grid: no boxes, no icons-in-circles, just
              a definition list with a rule between entries. */}
          <dl className="mt-8 grid gap-8 sm:grid-cols-3">
            {CLAIMS.map(({ Icon, title, body }) => (
              <div key={title}>
                <Icon aria-hidden className="size-5 text-accent" />
                <dt className="mt-3 font-semibold">{title}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line py-14">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight">What This Is Not</h2>
            <p className="mt-3 leading-relaxed text-ink-muted">
              This is a prototype built for evaluation. It is not a registered medical device, no
              clinician has reviewed its output in a validation study, and every consultation in it
              is simulated. It is scoped to adult cough, sore throat, and related upper respiratory
              presentations, and it will tell you when a consultation falls outside that.
            </p>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-8 text-sm text-ink-muted">
        <span>Simulated data only. Not for clinical use.</span>
        <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">
          Privacy and Data Protection
        </Link>
      </footer>
    </div>
  )
}
