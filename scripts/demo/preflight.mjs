import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = import.meta.dir ?? dirname(fileURLToPath(import.meta.url))

export const DEFAULT_DEMO_FIXTURE = join(
  __dirname,
  '..',
  '..',
  'backend',
  'src',
  'fixtures',
  'demo-consultation.txt',
)

export function parseDemoUrl(value) {
  if (!value) throw new Error('DEMO_URL is required')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('DEMO_URL is not a valid URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('DEMO_URL must be http or https')
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('DEMO_URL must be an origin without credentials, path, query or fragment')
  }
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (!isLocalhost && parsed.protocol !== 'https:') {
    throw new Error('DEMO_URL remote hosts must use https')
  }
  const isProduction = !isLocalhost
  if (isProduction && process.env.DEMO_ALLOW_PRODUCTION !== '1') {
    throw new Error(
      'DEMO_URL is not localhost. Set DEMO_ALLOW_PRODUCTION=1 to acknowledge that this run writes data and may use a provider.',
    )
  }
  return { url: parsed, isLocalhost, isProduction }
}

export function validateRecordingEnv({ requireCredentials = true } = {}) {
  const { url } = parseDemoUrl(process.env.DEMO_URL)
  const email = process.env.DEMO_EMAIL
  const password = process.env.DEMO_PASSWORD
  if (requireCredentials) {
    if (!email) throw new Error('DEMO_EMAIL is required for recording or shot checks')
    if (!password) throw new Error('DEMO_PASSWORD is required for recording or shot checks')
  }
  return { baseUrl: url.href.replace(/\/$/, ''), email, password }
}

export function extractFinishShotBudgets(source) {
  const budgets = new Map()
  for (const match of source.matchAll(/finishShot\('([a-z0-9-]+)',\s*([\d_]+)\)/g)) {
    budgets.set(match[1], Number(match[2].replaceAll('_', '')))
  }
  return budgets
}

export function parseNarrationLines(source) {
  const lines = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+)\s*\|\s*(\d+)\s*\|\s*(.*)$/.exec(line)
    if (match) lines.push({ beat: match[1], offset: Number(match[2]), text: match[3] })
  }
  return lines
}

export function checkBeatNarrationAgreement(workflowSource, narrationSource) {
  const budgets = extractFinishShotBudgets(workflowSource)
  const lines = parseNarrationLines(narrationSource)
  const beats = [...new Set(lines.map((line) => line.beat))]
  const missing = beats.filter((beat) => !budgets.has(beat))
  if (missing.length > 0) {
    throw new Error(`narration references beats with no recorder budget: ${missing.join(', ')}`)
  }

  const WPM = 175
  const spokenMs = (text) => (text.split(/\s+/).filter(Boolean).length / WPM) * 60_000
  const order = [...new Set(lines.map((line) => line.beat))]
  for (let index = 0; index < order.length - 1; index += 1) {
    const beat = order[index]
    const next = order[index + 1]
    const beatLines = lines.filter((line) => line.beat === beat)
    const ends = Math.max(...beatLines.map((line) => line.offset + spokenMs(line.text)))
    const nextStart = budgets.get(beat) + (lines.find((line) => line.beat === next)?.offset ?? 0)
    if (ends > nextStart) {
      throw new Error(`narration for ${beat} runs into the start of ${next}`)
    }
  }
}

export function checkNoApproveInSource(...sources) {
  const patterns = [
    /await\s+(?:tooling\.)?click\([^)]*?\b(?:Approve\s+Note|Confirm\s+Approval)\b/,
    /api\.approve\s*\(/,
    /\/consultations\/[^'")]*approve/,
  ]
  for (const [path, source] of sources) {
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        throw new Error(`${path} appears to call an approval action: ${pattern}`)
      }
    }
  }
}

export function checkFixture(fixturePath = DEFAULT_DEMO_FIXTURE) {
  if (!existsSync(fixturePath)) throw new Error(`missing demo transcript fixture: ${fixturePath}`)
  const text = readFileSync(fixturePath, 'utf8')
  const hasDoctor = /^Doctor:/im.test(text)
  const hasPatient = /^Patient:/im.test(text)
  if (!hasDoctor || !hasPatient) {
    throw new Error(
      `demo transcript fixture must contain Doctor: and Patient: turns: ${fixturePath}`,
    )
  }
  return text
}

export function runAllChecks({ fixturePath = DEFAULT_DEMO_FIXTURE } = {}) {
  const results = []

  // 1. URL/prod gate (no credentials required for offline check)
  try {
    parseDemoUrl(process.env.DEMO_URL)
    results.push({ ok: true, check: 'DEMO_URL / production gate' })
  } catch (error) {
    results.push({ ok: false, check: 'DEMO_URL / production gate', detail: error.message })
  }

  // 2. Fixture exists and is a transcript
  try {
    checkFixture(fixturePath)
    results.push({ ok: true, check: 'demo transcript fixture' })
  } catch (error) {
    results.push({ ok: false, check: 'demo transcript fixture', detail: error.message })
  }

  // 3. No approve action in recorder, shot checks, or workflow
  try {
    const paths = ['record.mjs', 'check-shots.mjs', 'workflow.mjs'].map((name) =>
      join(__dirname, name),
    )
    const sources = paths.map((p) => [p, readFileSync(p, 'utf8')])
    checkNoApproveInSource(...sources)
    results.push({ ok: true, check: 'no approve action in recorder or shot checks' })
  } catch (error) {
    results.push({
      ok: false,
      check: 'no approve action in recorder or shot checks',
      detail: error.message,
    })
  }

  // 4. Narration matches recorder beat budgets
  try {
    const workflowSource = readFileSync(join(__dirname, 'workflow.mjs'), 'utf8')
    const narrationSource = readFileSync(join(__dirname, 'narration.txt'), 'utf8')
    checkBeatNarrationAgreement(workflowSource, narrationSource)
    results.push({ ok: true, check: 'narration matches recorder beats' })
  } catch (error) {
    results.push({ ok: false, check: 'narration matches recorder beats', detail: error.message })
  }

  return results
}

export async function run() {
  const results = runAllChecks()
  const failed = results.filter((r) => !r.ok)
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL'
    const detail = result.detail ? ` -- ${result.detail}` : ''
    console.log(`  ${mark}  ${result.check}${detail}`)
  }
  if (failed.length > 0) {
    console.error(`\npreflight failed: ${failed.length} check(s)`)
    process.exit(1)
  }
  console.log('\n[demo-preflight-ok]')
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(`
Usage: preflight.mjs
Run offline preflight checks for the CatatMD demo suite.

Checks:
  - DEMO_URL is set and, if non-local, DEMO_ALLOW_PRODUCTION=1 is set
  - backend/src/fixtures/demo-consultation.txt exists and has Doctor/Patient turns
  - record.mjs, check-shots.mjs and workflow.mjs do not call an approval action
  - narration.txt beats match the recorder's shot budgets

No browser, TTS, app connection, or credentials are needed.
`)
    return
  }
  await run()
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) await main()
