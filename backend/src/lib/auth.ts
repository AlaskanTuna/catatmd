import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { recordAuditEvent } from '../audit/index.js'
import { env } from '../config/env.js'
import { CLIENT_IP_HEADER } from '../middleware/client-ip.js'
import { logger } from './logger.js'
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
    /**
     * A single header, written by `middleware/client-ip.ts` on every request
     * before this router ever sees one.
     *
     * better-auth 1.6.27 refuses a multi-entry `x-forwarded-for` unless
     * `trustedProxies` is configured (`getIPFromHeader`: `if
     * (forwardedIps.length !== 1) return null`), which is correct: an unbounded
     * chain is trivially spoofable, so guessing which entry is the client would
     * be worse than declining. Declining, though, means `getIp()` returns null
     * and every caller shares one bucket per path, which turns a brute-force
     * control into a denial-of-service vector.
     *
     * Render's Cloudflare edge used to make `cf-connecting-ip` the answer here.
     * Since #156 the SPA reaches this API through a Vercel rewrite, so that
     * header holds Vercel's address rather than the caller's, and resolving the
     * caller now takes an allow-list check that a header name list cannot
     * express. `middleware/client-ip.ts` does that work once and publishes the
     * result here, which also keeps this limiter and the clinical ones keyed on
     * the same caller instead of resolving it independently.
     *
     * Single-valued and overwritten per request, so it is exactly the shape
     * `getIPFromHeader` accepts and a caller cannot supply their own.
     */
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },

  /**
   * Auth audit trail (issue #14). Actor id and event type only — never an
   * email, a password, a session token, an IP, or any clinical content.
   *
   * Routed through `recordAuditEvent` so the row joins the hash chain. Writing
   * `prisma.auditEvent.create` here directly is what issue #55 fixed: it
   * produced session rows with no `prevHash`, permanently outside the
   * tamper-evidence the chain exists to provide.
   *
   * **This is the one audit write that fails open.** Every consultation path
   * propagates a failed append, because a note whose approval was not recorded
   * should not read as approved. Sign-in is the opposite: after the retry in
   * `recordAuditEvent` is exhausted, locking a doctor out of a clinical system
   * because an audit row lost a race is the worse failure. The drop is logged
   * under its own error class rather than swallowed, so the gap is visible.
   */
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          try {
            await recordAuditEvent({
              action: 'auth.session.created',
              actorId: session.userId,
            })
          } catch (error) {
            logger.error('audit write dropped', {
              actorId: session.userId,
              errorClass: 'audit_write_error',
              errorName: error instanceof Error ? error.name : 'UnknownError',
            })
          }
        },
      },
    },
  },
})
