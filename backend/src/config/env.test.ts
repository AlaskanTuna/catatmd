import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `env.ts` calls `process.exit(1)` and throws at module scope, so each case
 * runs in a child process — importing it in-process would take the test runner
 * down with it.
 */
function boot(overrides: Record<string, string>) {
  try {
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        fileURLToPath(new URL('./env.ts', import.meta.url)),
      ],
      {
        env: { ...process.env, ...overrides },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    )
    return { ok: true, output: '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('env fail-fast (issue #14)', () => {
  it('boots with the repo .env as-is', () => {
    expect(boot({}).ok).toBe(true)
  })

  it('refuses to boot when BETTER_AUTH_SECRET is absent', () => {
    const { ok, output } = boot({ BETTER_AUTH_SECRET: '' })

    expect(ok).toBe(false)
    expect(output).toContain('Invalid environment')
  })

  it('refuses a BETTER_AUTH_SECRET shorter than 32 characters', () => {
    const { ok } = boot({ BETTER_AUTH_SECRET: 'too-short' })

    expect(ok).toBe(false)
  })

  it('refuses to boot when DATABASE_URL is absent', () => {
    const { ok, output } = boot({ DATABASE_URL: '' })

    expect(ok).toBe(false)
    expect(output).toContain('Invalid environment')
  })

  describe('LLM provider production guards', () => {
    it('refuses gemini in production', () => {
      const { ok, output } = boot({ NODE_ENV: 'production', LLM_PROVIDER: 'gemini' })

      expect(ok).toBe(false)
      expect(output).toContain('local-dev-only')
    })

    // docs/trd.md §19 row 9 — DeepSeek is PRC-hosted, raising the same
    // cross-border question Gemini was guarded for.
    it('refuses deepseek in production', () => {
      const { ok, output } = boot({ NODE_ENV: 'production', LLM_PROVIDER: 'deepseek' })

      expect(ok).toBe(false)
      expect(output).toContain('benchmarking-only')
    })

    it('refuses to disable the de-identification gate in production', () => {
      const { ok, output } = boot({ NODE_ENV: 'production', DEID_FAIL_CLOSED: 'false' })

      expect(ok).toBe(false)
      expect(output).toContain('DEID_FAIL_CLOSED')
    })
  })
})
