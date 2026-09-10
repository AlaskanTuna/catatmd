import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertCompleteTake, SHOT_NAMES } from './beats.mjs'
import { run as offlineCheck, validateRecordingEnv } from './preflight.mjs'
import { installCursor, makeTooling } from './tooling.mjs'
import {
  authenticateDemoAccount,
  defaultFixturePath,
  loadTranscript,
  runDemoFlow,
} from './workflow.mjs'

export { assertCompleteTake, normalizedBeatOffsets } from './beats.mjs'

export async function installSafetyGuard(context, onBlocked) {
  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    let allowed = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    if (method === 'POST') {
      allowed =
        path === '/api/patients' ||
        path === '/api/consultations' ||
        /^\/api\/consultations\/[^/]+\/analyze$/.test(path)
    }
    if (method === 'PATCH' && /^\/api\/consultations\/[^/]+$/.test(path)) {
      try {
        const body = request.postDataJSON()
        allowed =
          body !== null &&
          typeof body === 'object' &&
          !Array.isArray(body) &&
          Object.keys(body).length === 1 &&
          Object.hasOwn(body, 'transcript')
      } catch {
        allowed = false
      }
    }
    if (!allowed) {
      onBlocked()
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
}

export function assertSuccessfulRun(beats, claims, errors) {
  assertCompleteTake(beats)
  if (
    errors.length ||
    SHOT_NAMES.some((name) => !claims.some((claim) => claim.beat === name && claim.ok))
  ) {
    throw new Error('demo_take_incomplete')
  }
}

export async function recordDemo({ record = true } = {}) {
  const config = validateRecordingEnv()
  const timeout = Number(process.env.DEMO_TIMEOUT_MS ?? 30_000)
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('demo_timeout_invalid')
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const transcript = loadTranscript(defaultFixturePath())
  const parent =
    process.env.DEMO_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'catatmd-demo')
  const demoDir = join(parent, `take-${runId}`)
  const { chromium } = await import(process.env.DEMO_PLAYWRIGHT ?? 'playwright')
  const browser = await chromium.launch({ headless: process.env.DEMO_HEADLESS !== 'false' })
  let context
  let video
  let step = 'authentication'
  let failure = false
  const beats = []
  const claims = []
  const errors = []
  try {
    const { cookies } = await authenticateDemoAccount(browser, { ...config, timeout })
    if (record) {
      mkdirSync(parent, { recursive: true })
      mkdirSync(demoDir, { mode: 0o700 })
    }
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      serviceWorkers: 'block',
      storageState: { cookies, origins: [] },
      ...(record
        ? { recordVideo: { dir: join(demoDir, 'raw'), size: { width: 1440, height: 900 } } }
        : {}),
    })
    await installSafetyGuard(context, () => errors.push('blocked_write'))
    step = 'startup'
    // Keep offsets relative to page creation, not the first shot: the raw video includes navigation.
    const started = Date.now()
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)
    video = page.video()
    page.on('pageerror', () => errors.push('pageerror'))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push('console')
    })
    if (record) await installCursor(page)
    const mark = async (name) => {
      step = name
      beats.push({ name, ms: Date.now() - started })
      process.stdout.write(`${name}\n`)
    }
    const claim = async (beat, _statement, check) => {
      const ok = await check()
      claims.push({ beat, ok: ok === true })
      if (ok !== true) throw new Error('demo_anchor_missing')
    }
    const finishShot = async (name, duration) => {
      if (record) {
        const remaining =
          beats.find((beat) => beat.name === name).ms + duration - (Date.now() - started)
        if (remaining > 0) await page.waitForTimeout(remaining)
      }
    }
    await runDemoFlow(page, makeTooling(page, { cursor: record, timeout }), {
      baseUrl: config.baseUrl,
      transcript,
      runId,
      timeout,
      mark,
      claim,
      finishShot,
    })
    await mark('end')
    assertSuccessfulRun(beats, claims, errors)
  } catch {
    failure = true
  } finally {
    try {
      if (context) await context.close()
    } catch {
      failure = true
    }
    try {
      await browser.close()
    } catch {
      failure = true
    }
  }
  if (failure) {
    process.stderr.write(
      `demo failed at ${step}; browser errors: ${errors.length}; take is not eligible for narration\n`,
    )
    throw new Error('demo_run_failed')
  }
  if (record) {
    if (!video) throw new Error('demo_video_missing')
    renameSync(await video.path(), join(demoDir, 'capture.webm'))
    writeFileSync(join(demoDir, 'beats.json'), `${JSON.stringify(beats, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    writeFileSync(join(demoDir, 'take-ok'), 'catatmd-demo-v1\n', { flag: 'wx', mode: 0o600 })
    process.stdout.write(
      `Take saved. Set DEMO_DIR to this take for post-processing:\n${demoDir}\n[demo-take-ok]\n`,
    )
  } else {
    process.stdout.write('[demo-shots-ok]\n')
  }
  return { demoDir, beats, claims, errors }
}

export async function main({ record = true } = {}) {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      `CatatMD ${record ? 'recorder' : 'shot check'}\nRequired: DEMO_URL (frontend origin), DEMO_EMAIL, DEMO_PASSWORD.\nRemote HTTPS targets require DEMO_ALLOW_PRODUCTION=1. Use a dedicated synthetic-only account.\nThis creates a patient and consultation and runs potentially billable analysis. Stops before approval.\nDEMO_PLAYWRIGHT selects an external Playwright module; DEMO_HEADLESS=false shows the browser.\nDEMO_DIR is the parent of fresh take directories. Optional DEMO_TIMEOUT_MS (default 30000).\n--offline-check checks source/fixtures only. No credentials or browser needed.\nSee scripts/demo/README.md for setup and post-processing.\n`,
    )
    return
  }
  if (process.argv.includes('--offline-check')) {
    await offlineCheck()
    return
  }
  try {
    await recordDemo({ record })
  } catch {
    process.stderr.write(
      'demo failed; check configuration and operator guide (error contents withheld)\n',
    )
    process.exitCode = 1
  }
}
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry === import.meta.url) await main()
