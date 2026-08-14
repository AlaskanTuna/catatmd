import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * GitHub issue #10, acceptance criterion 1: `approved` must be unreachable
 * without an explicit clinician action, **proven by a test** rather than by
 * reading the routes.
 *
 * The invariant already held when this was written. It is the strongest claim
 * the product makes, because the whole clinical-safety argument reduces to it:
 * nothing auto-approves, so no clinical record becomes a doctor's without the
 * doctor saying so. A second writer would not announce itself, and the two
 * plausible ones are a convenience helper that "finalises" a consultation and
 * a seed script that wants realistic data.
 *
 * Two scope choices, both deliberate:
 *
 * 1. **`prisma/` is scanned as well as `backend/src`.** The seed scripts write
 *    the same table, and a guard that cannot see the file it would most
 *    plausibly be bypassed from is not much of a guard. This mirrors
 *    `audit/no-stray-audit-writes.test.ts`.
 * 2. **Assignment is distinguished from comparison.** `status: 'approved'`
 *    sets it; `status === 'approved'` merely asks. The routes are full of the
 *    latter (the analyse route refuses to run on an approved consultation, the
 *    patch route refuses to edit one), and a guard that fired on those would be
 *    turned off within a week.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const SCANNED_TREES = [
  { dir: 'backend/src', extensions: ['.ts'] },
  { dir: 'prisma', extensions: ['.ts'] },
]

/** The transition, as written to Prisma. Not `===`, which only reads it. */
const APPROVAL_WRITE = /\bstatus:\s*['"]approved['"]/

/**
 * The complete set of places allowed to perform the transition, as
 * `path:line`. One entry, which is the point.
 */
const EXPECTED = ['backend/src/routes/consultations.ts']

/**
 * Tests construct approved consultations directly to exercise the terminal
 * state, which is legitimate and is not a code path a doctor can reach.
 */
function isExempt(path: string): boolean {
  return /\.test\.tsx?$/.test(path)
}

/**
 * A guard that forbids describing the thing it guards against gets worked
 * around, and no line starting a comment can execute.
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

/** Every place the approved transition is written, as `path:line`. */
function approvalWrites(): string[] {
  const found: string[] = []

  for (const path of sourceFiles()) {
    if (isExempt(path)) continue

    readFileSync(join(REPO_ROOT, path), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (isComment(line) || !APPROVAL_WRITE.test(line)) return
        found.push(`${path}:${index + 1}`)
      })
  }

  return found
}

describe('only the approve route can approve (issue #10, AC1)', () => {
  it('finds source to scan in both trees, so an empty pass means something', () => {
    const scanned = sourceFiles()

    expect(scanned.some((path) => path.startsWith('backend/src/'))).toBe(true)
    expect(scanned.some((path) => path.startsWith('prisma/'))).toBe(true)
  })

  it('tells an assignment apart from a comparison', () => {
    expect(APPROVAL_WRITE.test("data: { status: 'approved', approvedAt: new Date() }")).toBe(true)
    expect(APPROVAL_WRITE.test('data: { status: "approved" }')).toBe(true)

    // Every one of these appears in the routes today and must never fire.
    expect(APPROVAL_WRITE.test("if (consultation.status === 'approved') {")).toBe(false)
    expect(APPROVAL_WRITE.test("consultation.status === 'approved'")).toBe(false)
    expect(APPROVAL_WRITE.test("status !== 'approved'")).toBe(false)
  })

  it('keeps the transition in exactly one file', () => {
    const files = [...new Set(approvalWrites().map((entry) => entry.slice(0, entry.indexOf(':'))))]

    expect(
      files,
      'Something outside the approve route sets a consultation to approved. ' +
        'Approval is the transition that makes a clinical record the doctor’s ' +
        'and it may only happen through an explicit clinician action ' +
        '(docs/prd.md CAP-5). If a new caller is genuinely needed, it must go ' +
        'through the same 409-guarded route rather than writing the status.',
    ).toEqual(EXPECTED)
  })

  it('keeps it to a single write, so a second one in the same file still fails', () => {
    expect(
      approvalWrites(),
      'The approve route grew a second write of the approved status. One ' +
        'transition means one place to audit, one place to guard, and one ' +
        'place a reviewer has to read.',
    ).toHaveLength(1)
  })
})
