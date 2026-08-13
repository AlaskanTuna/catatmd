import { ArrowRight, FileLock2, MapPin, Stethoscope, UserCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

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

const LIMITS = [
  {
    term: 'Not a Registered Medical Device',
    body: 'It is a prototype built for evaluation, and no clinician has reviewed its output in a validation study.',
  },
  {
    term: 'Not Real Patient Data',
    body: 'Every consultation in it is simulated and was written for testing. The system is not connected to any clinical record system.',
  },
  {
    term: 'Not General Practice',
    body: 'It is scoped to adult cough, sore throat, and related upper respiratory presentations, and it will tell you when a consultation falls outside that.',
  },
]

export function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      {/* Two columns, and the art is the second one rather than a backdrop
          behind the words. The single-column version left half the viewport
          empty at every width above `lg`, which is what made the page read as
          a document rather than as a product. Below `lg` the art is dropped
          instead of shrunk: at that size it would be competing with the
          heading for the same 400px. */}
      <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-medium text-accent">
            Prototype · adult upper respiratory consultations
          </p>
          {/* Fixed rem, not clamp. The ceiling stays well under the 6rem
              shouting line, and the copy is tested at every breakpoint so a
              long word cannot overflow a narrow column. */}
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-[2.75rem]">
            The consultation is already documented. It just needs you to check it.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
            CatatMD turns a GP consultation transcript into a structured clinical note, tells you
            what the consultation did not establish, and shows its working. You review, edit, and
            approve. It does not diagnose.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              to="/login"
              className="inline-flex h-12 items-center gap-2 rounded-pill bg-accent px-7 text-base font-medium text-accent-ink shadow-raised transition-[background-color,transform] duration-150 ease-out-quart hover:bg-accent-hover active:scale-[0.97]"
            >
              Try the Demo
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <MapPin aria-hidden className="size-4" />
              Hosted in Singapore
            </span>
          </div>
        </div>

        <img
          src="/art/hero.webp"
          alt=""
          aria-hidden="true"
          className="hidden w-full max-w-md justify-self-end lg:block"
        />
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

      {/* Three limits, one per line, rather than the single paragraph this
          was. The facts are unchanged; what changed is that a reader can now
          take them one at a time. A block of caveats is the place a reader
          skims first and remembers least, which is the opposite of what a
          disclaimer is for. */}
      <section className="border-t border-line py-14">
        <h2 className="text-xl font-semibold tracking-tight">What This Is Not</h2>
        <dl className="mt-6 flex max-w-2xl flex-col gap-5">
          {LIMITS.map(({ term, body }) => (
            <div key={term}>
              <dt className="font-semibold">{term}</dt>
              <dd className="mt-1 leading-relaxed text-ink-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
