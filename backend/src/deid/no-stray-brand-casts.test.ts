import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * GitHub issue #86, sibling of #81.
 *
 * `.claude/rules/security.md` says a `value as Deidentified` cast is a
 * review-blocking defect rather than a style problem, because the compiler
 * cannot stop it. #81 closed the provider SDK route into the PHI boundary. The
 * cast is the other route, and it is the one the type system provably cannot
 * catch, so until now it was enforced by review alone.
 *
 * Three decisions, all deliberate:
 *
 * 1. **Casts are resolved from the AST, never matched as text.** Measured on
 *    the real casts before writing this: a naive `/as Deidentified/` catches
 *    `as unknown as Deidentified` only by accident of substring, and misses
 *    `as  Deidentified` with a double space, a line-wrapped cast, and
 *    `as Readonly<Deidentified>` outright. Parsing also means prose naming the
 *    pattern cannot trip the guard, so no `isComment` helper is needed here.
 * 2. **The inventory is pinned per file, not merely allowlisted by path.** A
 *    second cast inside an already-allowed file is exactly the change worth
 *    catching, and a path allowlist would wave it through. This is the same
 *    argument as pinning the provider SDK count at one in #81.
 * 3. **Files are allowed, lines are not.** A `path:line` allowlist looks
 *    stricter and is worse: it breaks on any edit above the line, so it would
 *    be updated reflexively, which is how an allowlist stops being read.
 *    Pinning the count per file recovers the strictness without the drift.
 *
 * A fourth option was considered and rejected: exporting a deliberately ugly
 * `__unsafeBrandForTest` so the raw cast could be banned outright. It reads as
 * more rigorous and is not. It collides with the rule immediately above it,
 * that minting is deliberately not exported, and a test-only brander is a
 * second minting path that is module-private today and one careless import
 * from not being.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const SCANNED_TREES = [
  { dir: 'backend/src', extensions: ['.ts'] },
  { dir: 'frontend/src', extensions: ['.ts', '.tsx'] },
  { dir: 'shared/src', extensions: ['.ts'] },
  { dir: 'prisma', extensions: ['.ts'] },
]

const BRAND = 'Deidentified'

/**
 * The complete, intended inventory of brand casts. Every entry is a place
 * someone had to justify, so adding one is a reviewable event rather than a
 * category of exemption.
 *
 * `backend/src/deid/index.ts` is `markDeidentified` itself, the sanctioned
 * minting site, which is module-private precisely so this is the only one.
 *
 * `backend/src/lib/llm/openai-compatible.test.ts` reproduces the provenance
 * gap the egress guard exists to close (#81). It brands a string that still
 * carries identifiers, which is the attack being simulated, and there is no
 * other way to construct that fixture now that minting is private.
 */
const EXPECTED_CASTS: ReadonlyMap<string, number> = new Map([
  ['backend/src/deid/index.ts', 1],
  ['backend/src/lib/llm/openai-compatible.test.ts', 1],
])

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

/** True when a type node names the brand anywhere inside it. */
function namesBrand(type: ts.TypeNode): boolean {
  let found = false

  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === BRAND) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(type)
  return found
}

/**
 * Every cast to the brand, as `path:line`.
 *
 * `x as unknown as Deidentified` is one violation rather than two: the outer
 * expression is the one whose type names the brand, and the inner `as unknown`
 * brands nothing.
 */
function brandCasts(): string[] {
  const found: string[] = []

  for (const path of sourceFiles()) {
    const text = readFileSync(join(REPO_ROOT, path), 'utf8')
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node) => {
      const isCast = ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      if (isCast && namesBrand(node.type)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        found.push(`${path}:${line}`)
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
  }

  return found
}

/** `['a.ts:1', 'a.ts:9']` to `{ 'a.ts': 2 }`. */
function countByFile(locations: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const location of locations) {
    const path = location.slice(0, location.lastIndexOf(':'))
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return counts
}

describe('only deid mints the brand (issue #86)', () => {
  it('finds source to scan in every tree, so an empty pass means something', () => {
    const scanned = sourceFiles()

    for (const { dir } of SCANNED_TREES) {
      expect(
        scanned.some((path) => path.startsWith(`${dir}/`)),
        `scanned no files under ${dir}; the walk is broken or the tree moved`,
      ).toBe(true)
    }
  })

  it('resolves every cast form, not just the plain one', () => {
    const forms = [
      'const a = x as Deidentified',
      'const b = x as unknown as Deidentified',
      'const c = x as  Deidentified',
      'const d = x as\n  Deidentified',
      'const e = x as Readonly<Deidentified>',
      'const f = <Deidentified>x',
    ]

    for (const form of forms) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0

      const visit = (node: ts.Node) => {
        if (
          (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
          namesBrand(node.type)
        ) {
          hits += 1
        }
        ts.forEachChild(node, visit)
      }
      visit(source)

      expect(hits, `${JSON.stringify(form)} should be caught exactly once`).toBe(1)
    }
  })

  it('does not fire on prose or on unrelated casts', () => {
    const benign = [
      '// a deliberate `value as Deidentified` cast is still possible',
      'const message = "returns value as Deidentified"',
      'const g = x as DeidentificationResult',
      'const h = x as string',
    ]

    for (const form of benign) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0

      const visit = (node: ts.Node) => {
        if (
          (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
          namesBrand(node.type)
        ) {
          hits += 1
        }
        ts.forEachChild(node, visit)
      }
      visit(source)

      expect(hits, `${JSON.stringify(form)} should not be caught`).toBe(0)
    }
  })

  it('matches the intended inventory exactly, file by file', () => {
    const actual = countByFile(brandCasts())

    expect(
      Object.fromEntries([...actual].sort()),
      'A cast to Deidentified appeared, moved, or disappeared. Branding a value ' +
        'outside deid/ bypasses detection entirely: the type system guarantees ' +
        'the shape of what reaches LLMClient, never its provenance. Call ' +
        'deidentify() instead. If a new cast is genuinely unavoidable, adding it ' +
        'to EXPECTED_CASTS is the reviewable decision this test exists to force.',
    ).toEqual(Object.fromEntries([...EXPECTED_CASTS].sort()))
  })
})
