import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

/**
 * PDPA notice.
 *
 * Written against Malaysia's Personal Data Protection Act 2010 rather than a
 * generic template, because the honest answer here is unusually short: this
 * prototype holds no personal data of data subjects at all. Every consultation
 * is synthetic, and the only real personal data in the system is the account
 * email of the doctor using it.
 *
 * Saying that plainly is worth more than a long policy that implies otherwise.
 * A privacy page that lists rights over patient data we do not hold would be
 * inaccurate in the direction that matters.
 */
export function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 pt-10 pb-20">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </Link>
      <div className="mt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy and Data Protection</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Personal Data Protection Act 2010 (Malaysia). Last updated 13 August 2026.
        </p>

        <Section title="What This System Holds">
          <p>
            CatatMD is an evaluation prototype. Every consultation transcript in it is synthetic and
            was written for testing. No real patient data has ever been entered, and the system is
            not connected to any clinical record system.
          </p>
          <p>
            The only personal data processed is the account details of the clinician using it: name,
            email address, and a hashed password. Guest sign-in uses a single shared demo account
            and collects nothing.
          </p>
        </Section>

        <Section title="What Leaves This System">
          <p>
            Consultation text is sent to a large language model provider for analysis. Before any
            text leaves the API, it passes a de-identification gate that replaces personal
            identifiers, including names and NRIC numbers, with pseudonymous tokens. The tokens are
            resolved back to the original values only after the response returns, inside our own
            infrastructure.
          </p>
          <p>
            The model provider therefore receives de-identified text. It never receives account
            details, and it never receives the mapping between a token and the value behind it.
          </p>
        </Section>

        <Section title="Where Data Is Stored">
          <p>
            The application, the API, and the database are all hosted locally, as is the default
            model endpoint. Data residency was a design requirement rather than an afterthought, and
            the model provider is a swappable adapter specifically so the region can change without
            changing the application.
          </p>
        </Section>

        <Section title="Retention and Access">
          <p>
            A consultation is visible only to the clinician account that created it. Access is
            checked on every request rather than assumed from a session. Actions that touch clinical
            content are recorded in an append-only audit log that stores identifiers and event
            types, never transcript or note content.
          </p>
          <p>
            Because this is a prototype, data may be deleted at any time without notice, and you
            should not rely on it for retention of anything.
          </p>
        </Section>

        <Section title="Your Rights">
          <p>
            Under the PDPA you may request access to, or correction of, the personal data held about
            you, and you may withdraw consent to its processing. For this prototype that means your
            account details. Requests can be raised through the repository maintainers.
          </p>
        </Section>

        <Section title="Not a Medical Device">
          <p>
            CatatMD does not diagnose and does not replace clinical judgement. It is not a
            registered medical device, and no clinician has reviewed its output in a validation
            study. Every output requires review and explicit approval by the treating doctor, who
            remains fully responsible for all clinical decisions.
          </p>
        </Section>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 leading-relaxed text-ink-muted">{children}</div>
    </section>
  )
}
