import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ANALYSIS_TIMEOUT_MS = 180_000

export async function authenticateDemoAccount(
  browser,
  { baseUrl, email, password, timeout = 30_000 },
) {
  const context = await browser.newContext({ baseURL: baseUrl })
  try {
    const response = await context.request.post('/api/auth/sign-in/email', {
      data: { email, password },
      headers: { Origin: baseUrl },
      timeout,
      maxRedirects: 0,
    })
    if (!response.ok()) throw new Error('demo_auth_failed')
    const cookies = await context.cookies()
    if (!cookies.length) throw new Error('demo_auth_failed')
    return { cookies }
  } finally {
    await context.close()
  }
}

export function loadTranscript(fixturePath) {
  try {
    return readFileSync(fixturePath, 'utf8')
  } catch {
    throw new Error('demo_fixture_unreadable')
  }
}

export async function runDemoFlow(page, tooling, options) {
  const {
    baseUrl,
    transcript,
    mark = () => {},
    claim = async () => {},
    finishShot = async () => {},
    timeout = 30_000,
    runId,
  } = options

  const patientName = `CatatMD Demo Patient ${runId}`

  await page.goto(new URL('/patients/new', baseUrl).href, { waitUntil: 'domcontentloaded' })
  await tooling.must(
    page.getByRole('heading', { name: 'Register Patient' }),
    'register patient heading',
  )

  // shot-1: register a clearly synthetic adult patient with minimal fields
  await mark('shot-1')
  await claim(
    'shot-1',
    'the new patient form is open with name, age and register button',
    async () => {
      const name = page.getByLabel('Name')
      const age = page.getByLabel('Age')
      const register = page.getByRole('button', { name: 'Register Patient' })
      await Promise.all([
        name.waitFor({ state: 'visible', timeout }),
        age.waitFor({ state: 'visible', timeout }),
        register.waitFor({ state: 'visible', timeout }),
      ])
      return true
    },
  )
  await tooling.type(page.getByLabel('Name'), patientName)
  await tooling.fill(page.getByLabel('Age'), '34')
  await finishShot('shot-1', 14_000)
  await tooling.click(page.getByRole('button', { name: 'Register Patient' }))
  await page.waitForURL(/\/patients\/[^/]+$/)

  // shot-2: patient profile and start consultation
  await tooling.must(
    page.getByRole('heading', { name: 'Patient Profile' }),
    'patient profile heading',
  )
  await mark('shot-2')
  await claim(
    'shot-2',
    'patient profile shows the new record and a Start Consultation button',
    async () => {
      return (await page.getByRole('button', { name: /Start Consultation/ }).count()) > 0
    },
  )
  await finishShot('shot-2', 12_000)
  await tooling.click(page.getByRole('button', { name: /Start Consultation/ }).first())
  await page.waitForURL(/\/consultations\/[^/]+$/)

  // shot-3: open the Paste tab
  await tooling.must(page.getByRole('tab', { name: 'Paste' }), 'paste tab')
  await mark('shot-3')
  await tooling.click(page.getByRole('tab', { name: 'Paste' }))
  await claim('shot-3', 'the paste tab is active with a transcript field', async () => {
    const textarea = page.locator('textarea[placeholder*="Doctor:"]')
    await textarea.waitFor({ state: 'visible', timeout })
    return true
  })
  await finishShot('shot-3', 10_000)

  // shot-4: paste the supplied synthetic transcript
  await mark('shot-4')
  const textarea = page.locator('textarea[placeholder*="Doctor:"]')
  await tooling.fill(textarea, transcript)
  await claim('shot-4', 'the transcript parses and Use This Transcript is enabled', async () => {
    const button = page.getByRole('button', { name: 'Use This Transcript' })
    await button.waitFor({ state: 'visible', timeout })
    return await button.isEnabled()
  })
  await finishShot('shot-4', 20_000)
  const consultationUrl = new URL(`/api${new URL(page.url()).pathname}`, baseUrl).href
  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) => response.url() === consultationUrl && response.request().method() === 'PATCH',
      { timeout },
    ),
    tooling.click(page.getByRole('button', { name: 'Use This Transcript' })),
  ])
  if (!saved.ok()) throw new Error('demo_transcript_save_failed')
  await page
    .getByRole('button', { name: 'Analyse Consultation', exact: true })
    .and(page.locator(':enabled'))
    .waitFor({ state: 'visible', timeout })
  await tooling.must(page.getByRole('button', { name: /Analyse Consultation/ }), 'analyse button')

  // shot-5: Analyse Consultation is ready
  await mark('shot-5')
  await claim('shot-5', 'the Analyse Consultation button is visible and enabled', async () => {
    const button = page.getByRole('button', { name: /Analyse Consultation/ })
    return await button.isEnabled()
  })
  await finishShot('shot-5', 10_000)
  await mark('shot-6')
  const analysisUrl = new URL(`/api${new URL(page.url()).pathname}/analyze`, baseUrl).href
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) => response.url() === analysisUrl && response.request().method() === 'POST',
      { timeout: ANALYSIS_TIMEOUT_MS },
    ),
    tooling.click(page.getByRole('button', { name: 'Analyse Consultation', exact: true })),
  ])
  if (!response.ok()) throw new Error('demo_analysis_failed')
  const result = await response.json()
  if (result?.consultation?.status !== 'awaiting_review')
    throw new Error('demo_review_state_missing')
  const approveButton = page.getByRole('button', { name: 'Approve Note', exact: true })
  await approveButton.waitFor({ state: 'visible', timeout })
  await claim('shot-6', 'analysis reached Awaiting Review', async () => true)
  await finishShot('shot-6', 24_000)

  // shot-7: inspect the generated clinical note
  await tooling.scrollTo(page.getByRole('heading', { name: 'Clinical Note' }))
  await mark('shot-7')
  await claim('shot-7', 'the clinical note panel is visible', async () => {
    return await page.getByRole('heading', { name: 'Clinical Note' }).isVisible()
  })
  await finishShot('shot-7', 14_000)

  // shot-8: inspect the red flags and missing information panels
  const safety = page.locator('aside[aria-label="Clinical safety"]')
  const redFlags = safety.getByRole('heading', { name: /^Red Flags\s+\d+$/ })
  const missing = safety.getByRole('heading', { name: /^Missing Information\s+\d+$/ })
  await tooling.scrollTo(redFlags)
  await mark('shot-8')
  const flagsShown = await tooling.onCamera(redFlags)
  await tooling.pause(7_000)
  await tooling.scrollTo(missing)
  await claim(
    'shot-8',
    'both safety panel headings were shown; counts may be zero',
    async () => flagsShown && (await tooling.onCamera(missing)),
  )
  await finishShot('shot-8', 14_000)

  // shot-9: inspect the suggestions panel if the corpus produced any
  const suggestions = safety.getByRole('heading', { name: /^Suggestions\s+\d+$/ })
  await tooling.scrollTo(suggestions)
  await mark('shot-9')
  await claim(
    'shot-9',
    'the suggestions panel heading is on camera; its count may be zero',
    async () => tooling.onCamera(suggestions),
  )
  await finishShot('shot-9', 14_000)

  // shot-10: end at Awaiting Review, with the approve button present but untouched
  await tooling.scrollTo(approveButton)
  await mark('shot-10')
  await claim(
    'shot-10',
    'the record remains at Awaiting Review and the Approve Note button is untouched',
    async () => {
      const approve = await approveButton.count()
      const confirm = await page.getByRole('button', { name: 'Confirm Approval' }).count()
      return approve > 0 && confirm === 0 && (await tooling.onCamera(approveButton))
    },
  )
  await finishShot('shot-10', 16_000)
}

export function defaultFixturePath() {
  // scripts/demo is two directories below the repo root
  return fileURLToPath(new URL('../../backend/src/fixtures/demo-consultation.txt', import.meta.url))
}
