import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * GitHub issue #172, closing a gap left open by #171.
 *
 * `.claude/rules/security.md` says the ASR relay is the only path audio may
 * take out of the API, and that no other module may call an ASR provider. Until
 * now that was a sentence rather than a check. The sibling guard
 * `no-stray-provider-sdk.test.ts` catches a vendor arriving as an SDK import;
 * this one catches the case that guard structurally cannot see, which is the
 * case the relay itself is built on: an outbound call made with native `fetch`
 * and no dependency to notice.
 *
 * Three decisions, all deliberate:
 *
 * 1. **Calls are resolved from the AST, never matched as text.** Measured on
 *    the real file before writing this: `backend/src/lib/asr/ilmu.ts` contains
 *    two occurrences of the string `fetch`, one of which is the prose in its
 *    own header explaining why native fetch was chosen over the SDK. A text
 *    scan would either count that comment or need an `isComment` heuristic to
 *    excuse it. Parsing means prose naming the pattern cannot trip the guard,
 *    which matters most for a rule whose documentation has to discuss it.
 * 2. **The inventory is pinned per file, not allowlisted by path.** A second
 *    outbound call inside the file already permitted to make one is exactly the
 *    change worth catching, and a path allowlist would wave it through. Same
 *    argument as the per-file pin in `no-stray-brand-casts.test.ts`.
 * 3. **The scan keys on the call site, not on the hostname.** The ILMU base URL
 *    lives in `env`, so a hostname scan would read a variable name and prove
 *    nothing. What is invariant is that an outbound call exists at all.
 *
 * Scope is `backend/src` only. The SPA calls `fetch` on every screen and is a
 * different boundary entirely: it holds no provider key and reaches only our
 * own API. Test files are exempt because a test that stubs or asserts on
 * `fetch` is describing the boundary rather than crossing it.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const SCANNED_DIR = 'backend/src'

/**
 * The complete, intended inventory of outbound `fetch` calls in the API.
 *
 * One entry, and it is the audio egress the rule names. `transcribeWithIlmu`
 * uses native fetch because ILMU publishes no SDK (checked against the npm
 * registry when this guard was written, so there is no package name for
 * `no-stray-provider-sdk.test.ts` to pin either), and because importing a
 * second vendor SDK would trip that guard by design.
 *
 * Adding an entry here is the reviewable decision this test exists to force:
 * every one is a new path by which data leaves the API without passing the
 * de-identification gate, which raw audio structurally cannot pass.
 */
const EXPECTED_FETCH_CALLS: ReadonlyMap<string, number> = new Map([
  ['backend/src/lib/asr/ilmu.ts', 1],
])

function sourceFiles(): string[] {
  const found: string[] = []

  const walk = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(child)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        found.push(relative(REPO_ROOT, child).replaceAll('\\', '/'))
      }
    }
  }

  walk(join(REPO_ROOT, SCANNED_DIR))
  return found
}

/**
 * True for the call forms that actually reach the network.
 *
 * `fetch(...)` covers the global. The property form covers `globalThis.fetch`
 * and any aliased holder, which is the shape someone reaches for when working
 * around a guard they have noticed.
 */
function isFetchCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text === 'fetch'
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'fetch'
  return false
}

function fetchCalls(paths: readonly string[]): string[] {
  const found: string[] = []

  for (const path of paths) {
    const text = readFileSync(join(REPO_ROOT, path), 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

    const visit = (node: ts.Node) => {
      if (isFetchCall(node)) {
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

describe('only the ASR relay egresses with fetch (issue #172)', () => {
  it('finds source to scan, so an empty pass means something', () => {
    const scanned = sourceFiles()

    // A walk that silently returns nothing passes every assertion below
    // forever. The floor is deliberately well under the real count so it
    // survives ordinary refactoring, and well over zero.
    expect(
      scanned.length,
      'scanned almost no files under backend/src; the walk is broken or the tree moved',
    ).toBeGreaterThan(20)

    expect(
      scanned,
      'the one file the inventory pins was not scanned, so the inventory below proves nothing',
    ).toContain('backend/src/lib/asr/ilmu.ts')
  })

  it('excludes test files, which describe the boundary rather than cross it', () => {
    expect(sourceFiles().every((path) => !path.endsWith('.test.ts'))).toBe(true)
  })

  it('resolves the call forms that reach the network', () => {
    const forms = [
      'await fetch(url)',
      'fetch(url, { method: "POST" })',
      'const r = await globalThis.fetch(url)',
      'const r = await undici.fetch(url)',
    ]

    for (const form of forms) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0
      const visit = (node: ts.Node) => {
        if (isFetchCall(node)) hits += 1
        ts.forEachChild(node, visit)
      }
      visit(source)

      expect(hits, `${JSON.stringify(form)} should be caught exactly once`).toBe(1)
    }
  })

  it('does not fire on prose or on unrelated identifiers', () => {
    const benign = [
      '// Native fetch and FormData, deliberately not the OpenAI SDK',
      'const note = "the relay calls fetch(url) directly"',
      'const data = await prefetch(url)',
      'const rows = await repository.fetchAll()',
      'type Fetcher = typeof fetch',
    ]

    for (const form of benign) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0
      const visit = (node: ts.Node) => {
        if (isFetchCall(node)) hits += 1
        ts.forEachChild(node, visit)
      }
      visit(source)

      expect(hits, `${JSON.stringify(form)} should not be caught`).toBe(0)
    }
  })

  it('matches the intended inventory exactly, file by file', () => {
    const actual = countByFile(fetchCalls(sourceFiles()))

    expect(
      Object.fromEntries([...actual].sort()),
      'An outbound fetch call appeared, moved, or disappeared in backend/src. ' +
        'The ASR relay is the only egress that may make one, because audio ' +
        'cannot be de-identified and is therefore governed by bounds, audit ' +
        'and per-consultation consent instead. Text egress goes through ' +
        'deid/ then LLMClient. If a new outbound call is genuinely required, ' +
        'adding it to EXPECTED_FETCH_CALLS is the reviewable decision this ' +
        'test exists to force.',
    ).toEqual(Object.fromEntries([...EXPECTED_FETCH_CALLS].sort()))
  })
})
