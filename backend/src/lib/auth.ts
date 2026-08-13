import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { env } from '../config/env.js'
import { prisma } from './prisma.js'

/**
 * The SPA and the API sit on different registrable domains in every deployed
 * environment (`catatmd.vercel.app` → `catatmd-api.onrender.com`), so every API
 * call is cross-site and a `SameSite=Lax` cookie is simply never sent. The
 * failure is deceptive: sign-in returns 200 and every subsequent request
 * returns 401 (docs/trd.md §14).
 *
 * `SameSite=None` is only honoured alongside `Secure`, and browsers reject a
 * `Secure` cookie over plain http. Deriving both from the API's own scheme
 * keeps them in lockstep: an https deployment gets the cross-site pair, local
 * http dev gets `Lax` (correct there anyway — both ends are `localhost`, which
 * is same-site). There is no environment where one is set without the other.
 */
const isHttps = new URL(env.BETTER_AUTH_URL).protocol === 'https:'

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',

  // The SPA origin. `baseURL`'s own origin is trusted automatically.
  trustedOrigins: [env.CORS_ORIGIN],

  emailAndPassword: {
    enabled: true,
    // Open self-service sign-up is in scope (docs/trd.md §14). No email
    // verification: there is no mail provider configured, and requiring it
    // would lock every new account out permanently.
    requireEmailVerification: false,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  /**
   * Closes docs/trd.md §19 row 4 — "confirm the default rate limiting actually
   * covers /api/auth/sign-up/email on the installed version".
   *
   * Verified against better-auth 1.6.27: `getDefaultSpecialRules()` matches
   * `path.startsWith('/sign-up')` at 10s/3, so sign-up is covered by default.
   * Two defaults are wrong for this deployment and are overridden here:
   *
   *   - `enabled` defaults to `NODE_ENV === 'production'` only, which leaves
   *     the limiter untested until it reaches production.
   *   - `storage` defaults to in-memory, which a free-tier Render instance
   *     wipes every time it spins down — precisely when a brute-force attempt
   *     would resume. `database` persists the counters (`RateLimit` model).
   */
  rateLimit: {
    enabled: true,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/guest': { window: 60, max: 10 },
    },
  },

  advanced: {
    useSecureCookies: isHttps,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
    },
    // Render terminates TLS at its proxy, so the socket address is the proxy's.
    // Without this the rate limiter buckets every caller together.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  },

  /**
   * Auth audit trail (issue #14). Actor id and event type only — never an
   * email, a password, a session token, an IP, or any clinical content.
   */
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await prisma.auditEvent.create({
            data: { action: 'auth.session.created', actorId: session.userId },
          })
        },
      },
    },
  },
})
