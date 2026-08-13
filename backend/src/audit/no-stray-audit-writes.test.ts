import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Issue #55. `recordAuditEvent` is the only thing that may write `auditEvent`,
 * and this fails the build when something else does.
 *
 * That invariant was a doc comment until #55, and the comment was wrong: the
 * better-auth session hook wrote `prisma.auditEvent.create` directly, so every
 * `auth.session.created` row landed with no `prevHash` and sat permanently
 * outside the hash chain. Nothing failed, because nothing was checking.
 *
 * Two scope choices, both deliberate:
 *
 * 1. **Every write verb, not just `create`.** `audit_event` is append-only, so
 *    an `update` or `delete` reaching it is worse than a bypassed insert, not
 *    better.
 * 2. **`prisma/` is scanned as well as `backend/src`.** The seed runs against
 *    the same table, and a guard that cannot see the file it would most plausibly
 *    be bypassed from is not much of a guard.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The one module allowed to write the table. */
const AUDIT_MODULE = 'backend/src/audit/'

const SCANNED_TREES = [
  { dir: 'backend/src', extensions: ['.ts'] },
  { dir: 'prisma', extensions: ['.ts'] },
]

const AUDIT_WRITE =
  /\b\w+\.auditEvent\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/

/**
 * Tests stand in for Prisma at the module seam, so they name these methods by
 * necessity. The real writers are what this guards.
 */
function isExempt(path: string): boolean {
  return path.startsWith(AUDIT_MODULE) || /\.test\.tsx?$/.test(path)
}

/**
 * A guard that forbids *describing* the thing it guards against is a guard that
 * gets worked around. Prose explaining why the direct write was wrong should not
 * itself trip it, and no line starting a comment can execute.
 */
function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line)
}

function sourceFiles(): string[] {
  const found: string[] = []

  for (const { dir, extensions } of SCANNED_TREES) {
    const walk = (absolute: string) => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const child = join(absolute, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'migrations' && entry.name !== 'node_modules') walk(child)
        } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
          found.push(relative(REPO_ROOT, child).replaceAll('\\', '/'))
        }
      }
    }

    walk(join(REPO_ROOT, dir))
  }

  return found
}

describe('only the audit module writes AuditEvent (issue #55)', () => {
  it('finds source to scan in both trees, so an empty pass means something', () => {
    const scanned = sourceFiles()

    expect(scanned.some((path) => path.startsWith('backend/src/'))).toBe(true)
    expect(scanned.some((path) => path.startsWith('prisma/'))).toBe(true)
  })

  it('routes every audit write through recordAuditEvent', () => {
    const violations: string[] = []

    for (const path of sourceFiles()) {
      if (isExempt(path)) continue

      readFileSync(join(REPO_ROOT, path), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (isComment(line) || !AUDIT_WRITE.test(line)) return
          violations.push(`${path}:${index + 1}: ${line.trim()}`)
        })
    }

    expect(
      violations,
      'An AuditEvent write bypasses the hash chain. Rows written outside ' +
        'recordAuditEvent carry no prevHash and are not tamper-evident. Call ' +
        'recordAuditEvent instead, adding an action to the taxonomy if needed.',
    ).toEqual([])
  })
})
