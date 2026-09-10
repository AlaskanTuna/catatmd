import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkBeatNarrationAgreement,
  checkFixture,
  checkNoApproveInSource,
  DEFAULT_DEMO_FIXTURE,
  parseDemoUrl,
  runAllChecks,
  validateRecordingEnv,
} from './preflight.mjs'

let scratchDir: string
const cleanEnv = { ...process.env }

beforeAll(() => {
  scratchDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'catatmd-demo-test')
  mkdirSync(scratchDir, { recursive: true })
})

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('demo preflight', () => {
  beforeEach(() => {
    for (const key of ['DEMO_URL', 'DEMO_EMAIL', 'DEMO_PASSWORD', 'DEMO_ALLOW_PRODUCTION']) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(cleanEnv)) {
      process.env[key] = value
    }
  })

  test('rejects a missing DEMO_URL', () => {
    expect(() => parseDemoUrl('')).toThrow('DEMO_URL is required')
  })

  test('rejects a non-http(s) URL', () => {
    expect(() => parseDemoUrl('ftp://catatmd.local')).toThrow('must be http or https')
  })

  test('rejects a remote http URL', () => {
    expect(() => parseDemoUrl('http://catatmd.example.com')).toThrow('https')
  })

  test('rejects a remote https URL without the production gate', () => {
    expect(() => parseDemoUrl('https://catatmd.example.com')).toThrow('DEMO_ALLOW_PRODUCTION=1')
  })

  test('allows a remote https URL with the production gate', () => {
    process.env.DEMO_ALLOW_PRODUCTION = '1'
    const { isProduction } = parseDemoUrl('https://catatmd.example.com')
    expect(isProduction).toBe(true)
  })

  test('allows localhost http', () => {
    const { isLocalhost, isProduction } = parseDemoUrl('http://localhost:5173')
    expect(isLocalhost).toBe(true)
    expect(isProduction).toBe(false)
  })

  test('validates recording credentials', () => {
    process.env.DEMO_URL = 'http://localhost:5173'
    process.env.DEMO_EMAIL = 'demo@example.com'
    process.env.DEMO_PASSWORD = 'synthetic-only'
    const env = validateRecordingEnv()
    expect(env.baseUrl).toBe('http://localhost:5173')
    expect(env.email).toBe('demo@example.com')
    expect(env.password).toBe('synthetic-only')
  })

  test('validates URL without credentials when credentials are not required', () => {
    process.env.DEMO_URL = 'http://localhost:5173'
    const env = validateRecordingEnv({ requireCredentials: false })
    expect(env.email).toBeUndefined()
    expect(env.password).toBeUndefined()
  })

  test('rejects missing recording credentials', () => {
    process.env.DEMO_URL = 'http://localhost:5173'
    expect(() => validateRecordingEnv()).toThrow('DEMO_EMAIL is required')
  })

  test('rejects a source that clicks Approve Note', () => {
    const source = "await tooling.click(page.getByRole('button', { name: 'Approve Note' }))"
    expect(() => checkNoApproveInSource(['synthetic.mjs', source])).toThrow('approval action')
  })

  test('rejects a source that calls an approve API', () => {
    const source = 'api.approve(consultationId)'
    expect(() => checkNoApproveInSource(['synthetic.mjs', source])).toThrow('approval action')
  })

  test('passes a source that only waits for the approve button', () => {
    const source =
      "const approveButton = page.getByRole('button', { name: /Approve Note/ })\nawait approveButton.waitFor()"
    expect(() => checkNoApproveInSource(['workflow.mjs', source])).not.toThrow()
  })

  test('rejects narration that runs into the next beat', () => {
    const workflow = "finishShot('shot-1', 1_000)\nfinishShot('shot-2', 1_000)"
    const narration =
      'shot-1 | 0 | this is a very long line that will definitely not fit\nshot-2 | 0 | next.'
    expect(() => checkBeatNarrationAgreement(workflow, narration)).toThrow('runs into')
  })

  test('accepts narration that fits inside each beat budget', () => {
    const workflow = "finishShot('shot-1', 10_000)\nfinishShot('shot-2', 10_000)"
    const narration = 'shot-1 | 200 | short.\nshot-2 | 200 | short.'
    expect(() => checkBeatNarrationAgreement(workflow, narration)).not.toThrow()
  })

  test('checks the default demo transcript fixture', () => {
    expect(() => checkFixture(DEFAULT_DEMO_FIXTURE)).not.toThrow()
  })

  test('rejects an empty fixture', () => {
    const path = join(scratchDir, 'empty.txt')
    writeFileSync(path, 'no doctor or patient turns\n')
    expect(() => checkFixture(path)).toThrow('Doctor: and Patient:')
  })

  test('runs all checks against the real suite files', () => {
    process.env.DEMO_URL = 'http://localhost:5173'
    const results = runAllChecks()
    const failed = results.filter((r) => !r.ok)
    expect(failed).toHaveLength(0)
  })

  test('record.mjs --help does not import Playwright or connect', async () => {
    const record = fileURLToPath(new URL('./record.mjs', import.meta.url))
    const result = Bun.spawnSync({
      cmd: [process.execPath, record, '--help'],
      env: { ...process.env, DEMO_URL: '' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain('CatatMD recorder')
  })

  test('check-shots.mjs --help does not import Playwright or connect', async () => {
    const check = fileURLToPath(new URL('./check-shots.mjs', import.meta.url))
    const result = Bun.spawnSync({
      cmd: [process.execPath, check, '--help'],
      env: { ...process.env, DEMO_URL: '' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain('CatatMD shot check')
  })
})
