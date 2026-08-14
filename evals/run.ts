import { mkdir, writeFile } from 'node:fs/promises'
import {
  type ConsultationAnalysis,
  ConsultationAnalysisSchema,
  type Transcript,
} from '@shared/types'
import { FIXTURE_RUBRICS, FIXTURES } from '../backend/src/fixtures/index.js'
import { corpusIds } from '../backend/src/guidelines/index.js'
import { type Finding, gradeAll } from './graders.js'

/**
 * Runs every synthetic fixture through the **real** analysis pipeline and
 * grades what comes back.
 *
 * **This is not a test and must never become one.** It spends a real LLM call
 * per fixture, its results move with the provider, and `bun run test` stays
 * deterministic and free precisely because this lives outside it.
 *
 * It drives `POST /api/consultations/analyze-ephemeral` over HTTP rather than
 * importing the pipeline, for two reasons. That endpoint runs the same
 * `runAnalysis` a doctor's request runs, so there is no second copy of the
 * pipeline here to drift from the first; and it persists no `Consultation`, so
 * a run leaves the database as it found it.
 */

const API_URL = process.env.EVAL_API_URL ?? 'http://localhost:3001'
const ORIGIN = process.env.EVAL_ORIGIN ?? 'http://localhost:5173'

interface CaseResult {
  fixtureId: string
  label: string
  ok: boolean
  ms: number
  findings: Finding[]
  error?: string
}

/** Signs in as the guest account and returns the cookie header for later calls. */
async function signIn(): Promise<string> {
  const response = await fetch(`${API_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  })
  if (!response.ok) {
    throw new Error(`guest sign-in failed: ${response.status} ${await response.text()}`)
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length === 0) throw new Error('guest sign-in returned no session cookie')
  return cookies.map((c) => c.split(';')[0]).join('; ')
}

async function analyse(transcript: Transcript, cookie: string): Promise<ConsultationAnalysis> {
  const response = await fetch(`${API_URL}/api/consultations/analyze-ephemeral`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
    body: JSON.stringify({ transcript }),
  })
  if (!response.ok) {
    throw new Error(`analyse failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const body = (await response.json()) as { analysis: unknown }
  // Parsed rather than trusted. A harness that reports on a shape it never
  // checked would report confidently on nothing.
  return ConsultationAnalysisSchema.parse(body.analysis)
}

function render(results: CaseResult[], startedAt: string, wallMs: number): string {
  const criticalFailures = results.flatMap((r) =>
    r.findings.filter((f) => f.severity === 'critical' && !f.passed).map((f) => ({ r, f })),
  )
  const errored = results.filter((r) => r.error)

  const lines = [
    '# Eval Run',
    '',
    `- **Started:** ${startedAt}`,
    `- **API:** ${API_URL}`,
    `- **Fixtures:** ${results.length}`,
    `- **Wall clock:** ${(wallMs / 1000).toFixed(1)}s`,
    `- **Critical failures:** ${criticalFailures.length}`,
    `- **Errored:** ${errored.length}`,
    '',
    '## Summary',
    '',
    '| Fixture | Result | Latency |',
    '| --- | --- | --- |',
    ...results.map((r) => {
      const bad = r.findings.filter((f) => f.severity === 'critical' && !f.passed).length
      const verdict = r.error ? 'ERROR' : bad > 0 ? `${bad} critical` : 'pass'
      return `| \`${r.fixtureId}\` | ${verdict} | ${(r.ms / 1000).toFixed(1)}s |`
    }),
    '',
    '## Detail',
    '',
  ]

  for (const r of results) {
    lines.push(`### \`${r.fixtureId}\``, '', r.label, '')
    if (r.error) {
      lines.push(`**ERROR:** ${r.error}`, '')
      continue
    }
    lines.push('| Grader | Severity | Result | Detail |', '| --- | --- | --- | --- |')
    for (const f of r.findings) {
      lines.push(`| ${f.grader} | ${f.severity} | ${f.passed ? 'pass' : 'FAIL'} | ${f.detail} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const startedAt = new Date().toISOString()
  const started = Date.now()

  console.log(`Evals against ${API_URL}`)
  const cookie = await signIn()

  const results: CaseResult[] = []

  // Sequential on purpose. Concurrency here would measure the provider's rate
  // limiter rather than the pipeline, and per-fixture latency is one of the
  // numbers this exists to produce.
  for (const fixture of FIXTURES) {
    const rubric = FIXTURE_RUBRICS.find((r) => r.fixtureId === fixture.id)
    if (!rubric) {
      results.push({
        fixtureId: fixture.id,
        label: fixture.label,
        ok: false,
        ms: 0,
        findings: [],
        error: 'no rubric; fixtures.test.ts should have caught this',
      })
      continue
    }

    const at = Date.now()
    try {
      const analysis = await analyse(fixture.transcript, cookie)
      const findings = gradeAll(analysis, fixture.transcript, rubric.expectedRedFlagIds, corpusIds)
      const ok = findings.every((f) => f.severity !== 'critical' || f.passed)
      results.push({
        fixtureId: fixture.id,
        label: fixture.label,
        ok,
        ms: Date.now() - at,
        findings,
      })
      console.log(
        `  ${ok ? 'pass' : 'FAIL'}  ${fixture.id}  ${((Date.now() - at) / 1000).toFixed(1)}s`,
      )
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      results.push({
        fixtureId: fixture.id,
        label: fixture.label,
        ok: false,
        ms: Date.now() - at,
        findings: [],
        error,
      })
      console.log(`  ERROR ${fixture.id}: ${error}`)
    }
  }

  const report = render(results, startedAt, Date.now() - started)
  await mkdir(new URL('reports/', import.meta.url), { recursive: true })
  const path = new URL(`reports/${startedAt.replace(/[:.]/g, '-')}.md`, import.meta.url)
  await writeFile(path, report, 'utf8')
  console.log(`\nReport: ${path.pathname}`)

  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} fixture(s) failed a critical grader.`)
    process.exit(1)
  }
  console.log(`\nAll ${results.length} fixtures passed every critical grader.`)
}

await main()
