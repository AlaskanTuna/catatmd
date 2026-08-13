import { env } from '../backend/src/config/env.js'
import { auth } from '../backend/src/lib/auth.js'
import { prisma } from '../backend/src/lib/prisma.js'

/**
 * Seeds the accounts the demo depends on:
 *
 *  - two doctors, whose separate consultations are what the ownership-isolation
 *    step of the Demo Script actually observes (docs/prd.md §14, step 11)
 *  - the shared guest account behind "Sign in as guest" (#29), only when
 *    credentials are configured
 *
 * Accounts are created through better-auth's own sign-up endpoint rather than
 * by inserting rows: the password hash format is better-auth's to decide, and a
 * hand-written `Account` row would be unverifiable at sign-in.
 *
 * Idempotent — an existing email is left untouched, so re-running never
 * disturbs consultations already attached to a doctor.
 */
async function seedUser(email: string, password: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    console.log(`· ${name} already present, skipped`)
    return
  }

  await auth.api.signUpEmail({ body: { email, password, name } })
  console.log(`✓ ${name} created`)
}

async function main() {
  const doctorPassword = env.SEED_DOCTOR_PASSWORD

  if (!doctorPassword) {
    console.log('· SEED_DOCTOR_PASSWORD not set, skipping demo doctors')
  } else {
    await seedUser('dr.aisyah@catatmd.demo', doctorPassword, 'Dr Aisyah Rahman')
    await seedUser('dr.lim@catatmd.demo', doctorPassword, 'Dr Lim Wei Jian')
  }

  if (env.GUEST_EMAIL && env.GUEST_PASSWORD) {
    await seedUser(env.GUEST_EMAIL, env.GUEST_PASSWORD, 'Guest')
  } else {
    console.log('· GUEST_EMAIL/GUEST_PASSWORD not set, skipping guest account')
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
