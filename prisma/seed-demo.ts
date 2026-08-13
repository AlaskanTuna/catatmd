import { FIXTURES } from '../backend/src/fixtures/index.js'

/**
 * Seeds the shared guest account with a spread of consultations for a live
 * demo (GitHub issue #29 for the account itself).
 *
 * Everything goes through the HTTP API rather than direct database writes. The
 * consultation lifecycle carries invariants that live in the routes, not the
 * schema: the append-only audit trail and its hash chain (docs/trd.md §15), the
 * analysis version stamp, and the approval state transition. Inserting rows by
 * hand would produce a database that looks right and an audit log that does not
 * describe it.
 *
 * Idempotent by skipping, not by deleting. There is no delete endpoint, and
 * deleting a consultation directly would cascade to its `AuditEvent` rows and
 * break the chain (GitHub issue #64). A second run therefore fills in whatever
 * is missing and leaves existing consultations alone.
 */

const BASE = process.env.DEMO_SEED_BASE_URL ?? 'http://localhost:3001'

/** Target state per fixture, chosen so the demo list shows every screen path. */
const DEMO_PLAN = [
  { fixtureId: 'urti-gap-heavy', target: 'awaiting_review' },
  { fixtureId: 'urti-hard-red-flag', target: 'awaiting_review' },
  { fixtureId: 'urti-diagnosis-not-assessed', target: 'awaiting_review' },
  { fixtureId: 'urti-identifier-dense-routine', target: 'approved' },
  { fixtureId: 'urti-hard-uncertain', target: 'draft' },
] as const

type Target = (typeof DEMO_PLAN)[number]['target']

let cookie = ''

async function api(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  })

  const setCookie = response.headers.getSetCookie()
  if (setCookie.length > 0) {
    cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  }

  return response
}

async function expectOk(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${what} failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

/** The first patient turn is what identifies a fixture in an existing row. */
function signature(turns: readonly { speaker: string; text: string }[]): string {
  return turns.find((turn) => turn.speaker === 'patient')?.text ?? turns[0]?.text ?? ''
}

async function existingSignatures(): Promise<Set<string>> {
  const list = (await expectOk(await api('/consultations'), 'list consultations')) as {
    consultations: { id: string }[]
  }

  const signatures = new Set<string>()
  for (const row of list.consultations) {
    const detail = (await expectOk(
      await api(`/consultations/${row.id}`),
      `read consultation ${row.id}`,
    )) as { consultation: { transcript?: { turns?: { speaker: string; text: string }[] } } }

    const turns = detail.consultation.transcript?.turns
    if (turns) signatures.add(signature(turns))
  }
  return signatures
}

async function seedOne(fixtureId: string, target: Target): Promise<string> {
  const fixture = FIXTURES.find((f) => f.id === fixtureId)
  if (!fixture) throw new Error(`fixture ${fixtureId} not found`)

  const created = (await expectOk(
    await api('/consultations', {
      method: 'POST',
      body: JSON.stringify({ transcript: fixture.transcript }),
    }),
    `create ${fixtureId}`,
  )) as { consultation: { id: string } }

  const id = created.consultation.id
  if (target === 'draft') return `${fixtureId}: draft`

  await expectOk(await api(`/consultations/${id}/analyze`, { method: 'POST' }), `analyze ${id}`)
  if (target === 'awaiting_review') return `${fixtureId}: analysed`

  await expectOk(await api(`/consultations/${id}/approve`, { method: 'POST' }), `approve ${id}`)
  return `${fixtureId}: analysed and approved`
}

async function main() {
  await expectOk(await api('/auth/guest', { method: 'POST' }), 'guest sign-in')

  const present = await existingSignatures()
  console.log(`· guest account currently holds ${present.size} consultation(s)`)

  for (const { fixtureId, target } of DEMO_PLAN) {
    const fixture = FIXTURES.find((f) => f.id === fixtureId)
    if (!fixture) {
      console.log(`! ${fixtureId} not in the fixture corpus, skipped`)
      continue
    }

    if (present.has(signature(fixture.transcript.turns))) {
      console.log(`· ${fixtureId} already present, skipped`)
      continue
    }

    console.log(`  ${fixtureId}: seeding to ${target} ...`)
    console.log(`✓ ${await seedOne(fixtureId, target)}`)
  }
}

main().catch((err) => {
  console.error('Demo seed failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
