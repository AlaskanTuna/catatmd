import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTooling } from './tooling.mjs'
import { authenticateDemoAccount } from './workflow.mjs'

test('postprocessing rejects missing or invalid take markers before doing work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catatmd-marker-test-'))
  try {
    for (const marker of [null, 'wrong-version', 'catatmd-deck-v1']) {
      if (marker !== null) writeFileSync(join(dir, 'take-ok'), marker)
      for (const script of ['narrate.sh', 'assemble.sh']) {
        const result = Bun.spawnSync(['bash', join(import.meta.dir, script)], {
          env: { ...process.env, DEMO_DIR: dir, DEMO_PYTHON: '/not-a-real-interpreter' },
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr.toString()).toContain('successful take-ok marker required')
        expect(existsSync(join(dir, 'narration-segments'))).toBe(false)
        expect(existsSync(join(dir, 'assembly'))).toBe(false)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('offscreen authentication', () => {
  for (const succeeds of [true, false]) {
    test(`closes auth context after ${succeeds ? 'success' : 'failure'}`, async () => {
      let closed = false
      const browser = {
        newContext: async () => ({
          request: { post: async () => ({ ok: () => succeeds }) },
          cookies: async () => [{ name: 'synthetic-session' }],
          close: async () => {
            closed = true
          },
        }),
      }
      const attempt = authenticateDemoAccount(browser, {
        baseUrl: 'https://example.invalid',
        email: 'synthetic@example.invalid',
        password: 'mock-only',
      })
      if (succeeds) expect((await attempt).cookies).toHaveLength(1)
      else await expect(attempt).rejects.toThrow('demo_auth_failed')
      expect(closed).toBe(true)
    })
  }
})

test('on-camera checks reject offscreen headings even when visible in the DOM', async () => {
  const tooling = makeTooling({ viewportSize: () => ({ width: 1440, height: 900 }) })
  const locator = (y: number) => ({
    boundingBox: async () => ({ x: 20, y, width: 200, height: 30 }),
    isVisible: async () => true,
  })
  expect(await tooling.onCamera(locator(100))).toBe(true)
  expect(await tooling.onCamera(locator(1000))).toBe(false)
})
