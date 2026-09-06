import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The client-side counterpart to `backend/src/lib/asr/no-stray-fetch.test.ts`,
 * and the guard that boundary structurally cannot provide (#268).
 *
 * Ambient capture streams audio from the browser straight to the provider, so
 * for the first time in this system an egress happens where no server-side
 * check can see it. The backend guard pins the call that mints the key; this
 * one pins the socket that uses it. Without it, "the browser opens exactly one
 * socket, to one host, from one module" is a sentence in a document rather than
 * a property of the code.
 *
 * Three decisions carried over from the backend guard, for the same reasons:
 *
 * 1. **Sites are resolved from the AST, never matched as text.** This file and
 *    `soniox-stream.ts` both discuss `new WebSocket(` in prose, and a text scan
 *    would count the explanation as the thing it explains.
 * 2. **The inventory is pinned per file, not allowlisted by path.** A second
 *    socket inside the module already permitted one is exactly the change worth
 *    catching.
 * 3. **Adding an entry is the reviewable decision this test exists to force.**
 *    Every one is a new path by which patient audio can leave the device
 *    without passing through anything the API can observe or bound.
 *
 * Test files are exempt: a suite that fakes a socket is describing the boundary
 * rather than crossing it.
 */
/*
 * Resolved from the working directory rather than from `import.meta.url`,
 * because this suite runs under jsdom, where that is not a `file:` URL and
 * `fileURLToPath` throws. The precedent is `no-stray-dev-references.test.ts`.
 */
const SRC = join(process.cwd(), 'src')
const REPO_ROOT = join(process.cwd(), '..')

const EXTENSIONS = new Set(['.ts', '.tsx'])

const SKIPPED = new Set(['node_modules', 'dist'])

/**
 * The complete, intended inventory of WebSocket constructions in the SPA.
 *
 * One entry. `soniox-stream.ts` is the only module that may hold a socket, and
 * the CSP `connect-src` in `vercel.json` pins the one host it may open.
 */
const EXPECTED_WEBSOCKET_SITES: ReadonlyMap<string, number> = new Map([
  ['frontend/src/audio/live/soniox-stream.ts', 1],
])

function sourceFiles(): string[] {
  const found: string[] = []

  const walk = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(child)
      } else if (EXTENSIONS.has(extname(entry.name)) && !entry.name.includes('.test.')) {
        found.push(relative(REPO_ROOT, child).replaceAll('\\', '/'))
      }
    }
  }

  walk(SRC)
  return found
}

/**
 * True for the construction forms that actually open a connection.
 *
 * `new WebSocket(...)` covers the global. The property form covers
 * `globalThis.WebSocket` and `window.WebSocket`, which is the shape someone
 * reaches for when working around a guard they have noticed.
 */
function isWebSocketConstruction(node: ts.Node): boolean {
  if (!ts.isNewExpression(node)) return false
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text === 'WebSocket'
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 'WebSocket'
  return false
}

function websocketSites(paths: readonly string[]): string[] {
  const found: string[] = []

  for (const path of paths) {
    const text = readFileSync(join(REPO_ROOT, path), 'utf8')
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node) => {
      if (isWebSocketConstruction(node)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        found.push(`${path}:${line}`)
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
  }

  return found
}

function siteCounts(sites: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const site of sites) {
    const path = site.slice(0, site.lastIndexOf(':'))
    counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  return counts
}

describe('only the ambient stream client opens a socket (issue #268)', () => {
  it('finds source to scan, so an empty pass means something', () => {
    const scanned = sourceFiles()

    // A walk that silently returns nothing passes every assertion below
    // forever. The floor is well under the real count so it survives ordinary
    // refactoring, and well over zero.
    expect(
      scanned.length,
      'scanned almost no files under frontend/src; the walk is broken or the tree moved',
    ).toBeGreaterThan(30)

    for (const pinned of EXPECTED_WEBSOCKET_SITES.keys()) {
      expect(
        scanned,
        `${pinned} was not scanned, so the inventory below proves nothing about it`,
      ).toContain(pinned)
    }
  })

  it('excludes test files, which fake the boundary rather than cross it', () => {
    expect(sourceFiles().every((path) => !path.includes('.test.'))).toBe(true)
  })

  it('resolves the construction forms that open a connection', () => {
    const forms = [
      'const s = new WebSocket(url)',
      'new WebSocket(url, protocols)',
      'const s = new globalThis.WebSocket(url)',
      'const s = new window.WebSocket(url)',
    ]

    for (const form of forms) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0
      const visit = (node: ts.Node) => {
        if (isWebSocketConstruction(node)) hits += 1
        ts.forEachChild(node, visit)
      }
      visit(source)
      expect(hits, `${form} should be caught`).toBe(1)
    }
  })

  it('ignores the forms that do not open a connection', () => {
    const benign = [
      '// we deliberately use new WebSocket(url) in one module only',
      'const note = "new WebSocket(url)"',
      'type WebSocketLike = { send(data: unknown): void }',
      'if (typeof WebSocket === "undefined") return',
      'const s = new FakeWebSocket(url)',
      'socket.close()',
    ]

    for (const form of benign) {
      const source = ts.createSourceFile('probe.ts', form, ts.ScriptTarget.Latest, true)
      let hits = 0
      const visit = (node: ts.Node) => {
        if (isWebSocketConstruction(node)) hits += 1
        ts.forEachChild(node, visit)
      }
      visit(source)
      expect(hits, `${form} should not be caught`).toBe(0)
    }
  })

  it('matches the pinned inventory exactly', () => {
    const counts = siteCounts(websocketSites(sourceFiles()))

    // Appearing, moving, and disappearing all fail. A socket that vanishes is
    // as much a change to this boundary as one that appears.
    expect(
      Object.fromEntries([...counts].sort()),
      'the WebSocket inventory changed; every entry is a path by which patient ' +
        'audio leaves the device without the API observing it, so adding one is ' +
        'the reviewable decision this test exists to force',
    ).toEqual(Object.fromEntries([...EXPECTED_WEBSOCKET_SITES].sort()))
  })
})
