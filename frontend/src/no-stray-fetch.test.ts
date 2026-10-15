import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The request APIs the SPA uses, pinned per file (#436).
 *
 * A guard against drift, not a proof that nothing else can leave: an image
 * source, `window.open`, a form action, a dynamic `import(url)` or a `Request`
 * built and handed elsewhere are outside it, and the CSP `connect-src` is what
 * bounds those at the platform layer.
 *
 * The companion of `audio/live/no-stray-websocket.test.ts`, and needed for the
 * same reason: refinement after Stop uploads a finished recording from the
 * browser straight to a vendor, an egress no server-side check can observe.
 * Until it, every request the SPA made went to its own origin's `/api`, so
 * "one module may send a recording to a third party" was a sentence rather
 * than a property of the code.
 *
 * Three decisions carried over from the socket guard, for the same reasons:
 *
 * 1. **Sites are resolved from the AST, never matched as text.** Comments and
 *    strings that discuss `fetch(` are not requests.
 * 2. **The inventory is pinned per file**, so a second request inside a file
 *    already permitted one is caught.
 * 3. **Adding an entry is the reviewable decision this test exists to force.**
 *
 * One more, because the inventory alone cannot tell an origin apart: every
 * call outside the upload module and the preview stub must address our own
 * `/api`, so a cross-origin request added to an already-listed file still
 * fails.
 *
 * Test files are exempt: a suite that fakes the network is describing the
 * boundary rather than crossing it.
 */

/*
 * Resolved from the working directory rather than `import.meta.url`, which is
 * not a `file:` URL under jsdom; the precedent is `no-stray-websocket.test.ts`.
 */
const SRC = join(process.cwd(), 'src')
const REPO_ROOT = join(process.cwd(), '..')

const EXTENSIONS = new Set(['.ts', '.tsx'])

const SKIPPED = new Set(['node_modules', 'dist'])

/** The globals that put a request on the wire. */
const REQUEST_APIS = new Set(['fetch', 'XMLHttpRequest', 'sendBeacon', 'EventSource'])

/** The one module allowed to address a third party: the refinement upload. */
const CROSS_ORIGIN_MODULE = 'frontend/src/audio/live/elevenlabs-batch.ts'

/**
 * The preview stub replaces the global so every `/api` call is answered in the
 * browser, and passes anything else through untouched. It sends nothing of its
 * own, but it holds and reinstalls the global, which this inventory counts.
 */
const PREVIEW_STUB = 'frontend/src/preview/stub.ts'

/**
 * The complete, intended inventory of request-API references in the SPA.
 *
 * Every entry but one addresses our own origin's `/api`. `elevenlabs-batch.ts`
 * is the exception, and the CSP `connect-src` in `vercel.json` pins the one
 * host it may reach.
 */
const EXPECTED_REQUEST_SITES: ReadonlyMap<string, number> = new Map([
  ['frontend/src/audio/live/elevenlabs-batch.ts', 1],
  ['frontend/src/copilot/use-copilot.ts', 1],
  ['frontend/src/lib/api.ts', 2],
  ['frontend/src/preview/stub.ts', 3],
  ['frontend/src/routes/Settings.tsx', 1],
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

const parse = (path: string, text: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/** Inside a type annotation, where a name is a type and sends nothing. */
function inType(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current)) return true
  }
  return false
}

/**
 * True for a runtime reference to a request API: a call, a construction, a
 * property read such as `navigator.sendBeacon`, or an alias such as
 * `const send = fetch`. Aliasing is counted on purpose, because it is the shape
 * someone reaches for when working around a guard they have noticed.
 */
function isRequestReference(node: ts.Node): node is ts.Identifier | ts.StringLiteral {
  // `window['fetch']` and `globalThis["fetch"]` reach the same global.
  if (
    ts.isStringLiteral(node) &&
    REQUEST_APIS.has(node.text) &&
    ts.isElementAccessExpression(node.parent) &&
    node.parent.argumentExpression === node
  ) {
    return true
  }
  if (!ts.isIdentifier(node) || !REQUEST_APIS.has(node.text)) return false
  if (inType(node)) return false
  const parent = node.parent
  // A declared name or an object key is not a reference to the global.
  if (
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent)
  ) {
    return false
  }
  return true
}

function requestSites(source: ts.SourceFile): (ts.Identifier | ts.StringLiteral)[] {
  const found: (ts.Identifier | ts.StringLiteral)[] = []
  const visit = (node: ts.Node) => {
    if (isRequestReference(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function siteCounts(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const path of sourceFiles()) {
    const sites = requestSites(parse(path, readFileSync(join(REPO_ROOT, path), 'utf8')))
    if (sites.length > 0) counts.set(path, sites.length)
  }
  return counts
}

/**
 * Whether a call's first argument is `${BASE}/api...`, which is how every
 * same-origin request in the SPA is written.
 */
function addressesOwnApi(call: ts.CallExpression): boolean {
  const [target] = call.arguments
  if (target === undefined || !ts.isTemplateExpression(target)) return false
  const [first] = target.templateSpans
  return (
    target.head.text === '' &&
    first !== undefined &&
    ts.isIdentifier(first.expression) &&
    first.expression.text === 'BASE' &&
    first.literal.text.startsWith('/api')
  )
}

const probe = (form: string): number => requestSites(parse('probe.ts', form)).length

describe('only the refinement upload reaches past our own origin (issue #436)', () => {
  it('finds source to scan, so an empty pass means something', () => {
    const scanned = sourceFiles()

    expect(
      scanned.length,
      'scanned almost no files under frontend/src; the walk is broken or the tree moved',
    ).toBeGreaterThan(30)
    for (const pinned of EXPECTED_REQUEST_SITES.keys()) {
      expect(scanned, `${pinned} was not scanned`).toContain(pinned)
    }
  })

  it('excludes test files, which fake the network rather than use it', () => {
    expect(sourceFiles().every((path) => !path.includes('.test.'))).toBe(true)
  })

  it('resolves the forms that put a request on the wire', () => {
    for (const form of [
      'await fetch(url)',
      'await window.fetch(url)',
      'await globalThis.fetch(url, init)',
      'const send = fetch',
      'const xhr = new XMLHttpRequest()',
      'navigator.sendBeacon(url, body)',
      'const events = new EventSource(url)',
      "await window['fetch'](url)",
      'const send = globalThis["fetch"]',
    ]) {
      expect(probe(form), `${form} should be caught`).toBe(1)
    }
  })

  it('ignores the forms that do not', () => {
    for (const form of [
      '// fetch(url) is used in one module only',
      'const note = "fetch(url)"',
      'type Fetch = typeof fetch',
      'const handler: typeof fetch = stubbed',
      'void proposals.refetch()',
      'await queryClient.fetchQuery(options)',
      'const options = { fetch: undefined }',
      'function prefetch() {}',
      "const key = 'fetch'",
      "record['prefetch']",
    ]) {
      expect(probe(form), `${form} should not be caught`).toBe(0)
    }
  })

  it('matches the pinned inventory exactly', () => {
    // Appearing, moving and disappearing all fail: a request that vanishes is
    // as much a change to this boundary as one that appears.
    expect(
      Object.fromEntries([...siteCounts()].sort()),
      'the request inventory changed; a request to a third party is a path by which ' +
        'data leaves the browser without the API observing it, so adding one is the ' +
        'reviewable decision this test exists to force',
    ).toEqual(Object.fromEntries([...EXPECTED_REQUEST_SITES].sort()))
  })

  it('has every call outside the upload module address our own /api', () => {
    const strays: string[] = []
    for (const path of EXPECTED_REQUEST_SITES.keys()) {
      if (path === CROSS_ORIGIN_MODULE || path === PREVIEW_STUB) continue
      const source = parse(path, readFileSync(join(REPO_ROOT, path), 'utf8'))
      for (const site of requestSites(source)) {
        const call = site.parent
        const line = source.getLineAndCharacterOfPosition(site.getStart(source)).line + 1
        if (!ts.isCallExpression(call) || call.expression !== site || !addressesOwnApi(call)) {
          strays.push(`${path}:${line}`)
        }
      }
    }

    expect(strays, 'a request outside the upload module addresses another origin').toEqual([])
  })

  it('recognises an own-origin address, and refuses any other', () => {
    const firstCall = (form: string): ts.CallExpression => {
      let call: ts.CallExpression | undefined
      const visit = (node: ts.Node) => {
        if (call === undefined && ts.isCallExpression(node)) call = node
        ts.forEachChild(node, visit)
      }
      visit(parse('probe.ts', form))
      if (call === undefined) throw new Error('no call in probe')
      return call
    }

    // Built rather than written out, so the probe source carries a literal
    // `${BASE}` without a string that merely looks like a template.
    const templated = (address: string) => `fetch(\`${address.replace('BASE', `${'$'}{BASE}`)}\`)`
    expect(addressesOwnApi(firstCall(templated('BASE/api/settings')))).toBe(true)
    expect(addressesOwnApi(firstCall(templated('BASE/elsewhere')))).toBe(false)
    expect(addressesOwnApi(firstCall(templated('https://x.example/BASE/api')))).toBe(false)
    expect(addressesOwnApi(firstCall("fetch('https://api.example/v1')"))).toBe(false)
    expect(addressesOwnApi(firstCall('fetch(target)'))).toBe(false)
  })
})

/**
 * Who may start the upload (#436), pinned across the whole SPA.
 *
 * The inventory above pins where the one cross-origin request sits, not who
 * reaches it. The 16/10/26 grant covers post-Stop ambient refinement and no
 * other surface, so a dictation or review-page component importing the upload
 * module or minting a batch token would widen the egress past the grant while
 * every other guard stayed green. Only `AmbientCapture.tsx` may do either;
 * `batch-tokens.ts` imports the wire type and nothing that runs.
 */
const UPLOAD_MODULE = /(?:^|\/)elevenlabs-batch\.js$/
const UPLOAD_ENTRY_POINTS = new Set(['transcribeRecording', 'createBatchSession'])
const EXPECTED_UPLOAD_CALLERS = ['frontend/src/audio/live/AmbientCapture.tsx']

/** A value import of the upload module, which a type-only import is not. */
function importsUploadModule(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return false
    if (!UPLOAD_MODULE.test(statement.moduleSpecifier.text)) return false
    const clause = statement.importClause
    if (clause === undefined) return true
    if (clause.isTypeOnly) return false
    const bindings = clause.namedBindings
    const everyNamedIsType =
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.every((element) => element.isTypeOnly)
    return clause.name !== undefined || !everyNamedIsType
  })
}

/** A call to `transcribeRecording(...)` or `api.createBatchSession(...)`. */
function callsUploadEntryPoint(source: ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null
      if (name !== null && UPLOAD_ENTRY_POINTS.has(name)) found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('only ambient capture may start the refinement upload (issue #436)', () => {
  it('finds the upload imported and minted for in exactly one module', () => {
    const callers = sourceFiles().filter((path) => {
      const source = parse(path, readFileSync(join(REPO_ROOT, path), 'utf8'))
      return importsUploadModule(source) || callsUploadEntryPoint(source)
    })

    expect(
      callers,
      'a module other than AmbientCapture reaches the refinement upload; the egress ' +
        'is granted for post-Stop ambient refinement only, so this widens it',
    ).toEqual(EXPECTED_UPLOAD_CALLERS)
  })

  it('tells a type-only import apart from one that runs', () => {
    const probe = (text: string) => importsUploadModule(parse('probe.ts', text))

    expect(probe("import { transcribeRecording } from './elevenlabs-batch.js'")).toBe(true)
    expect(probe("import * as upload from '../live/elevenlabs-batch.js'")).toBe(true)
    expect(probe("import './elevenlabs-batch.js'")).toBe(true)
    expect(probe("import type { BatchWord } from './elevenlabs-batch.js'")).toBe(false)
    expect(probe("import { type BatchWord } from './elevenlabs-batch.js'")).toBe(false)
    expect(probe("import { transcribeRecording } from './elevenlabs-batch-notes.js'")).toBe(false)
  })

  it('recognises a call to either entry point', () => {
    const probe = (text: string) => callsUploadEntryPoint(parse('probe.ts', text))

    expect(probe('await transcribeRecording(session, blob, signal)')).toBe(true)
    expect(probe('await api.createBatchSession(signal, 60)')).toBe(true)
    expect(probe('await api.createLiveSession(signal, "ambient", true)')).toBe(false)
  })
})
