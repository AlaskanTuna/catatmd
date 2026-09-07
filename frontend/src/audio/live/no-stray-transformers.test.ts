import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Ambient capture must never pull the speech-inference library into the main
 * bundle (#219).
 *
 * `protocol.ts` records the measurement: importing a *value* from the worker's
 * module graph took the main chunk from 458 kB to 982 kB, which is why
 * `TranscriptSegment` is a type-only export living in a module of its own. That
 * rule has so far been prose, and prose held only because nothing under
 * `audio/live/` imported a value from outside the folder.
 *
 * The live panes changed that: `live-fold.ts` imports `../draft-turns.js` for
 * the shipped labelling path rather than reimplementing it, which is the right
 * call and also the first edge along which the library could arrive. So the
 * rule gets a test.
 *
 * Two scoping decisions, both deliberate:
 *
 * 1. **The whole transitive closure, not direct imports.** A one-hop check
 *    would pass the day someone adds an innocuous helper that itself reaches
 *    the worker. The harm is reachability, so reachability is what is measured.
 * 2. **Value imports only.** `import type` is erased before a bundler sees it
 *    and provably cannot affect a chunk, and the property being protected is
 *    bundle size. Flagging an erased import would be a false positive that
 *    invites a worse workaround.
 */
const SRC = join(process.cwd(), 'src')
const LIVE = join(SRC, 'audio', 'live')
const REPO_ROOT = join(process.cwd(), '..')

const FORBIDDEN = '@huggingface/transformers'

const EXTENSIONS = ['.ts', '.tsx']

const asPosix = (absolute: string) => relative(REPO_ROOT, absolute).replaceAll('\\', '/')

/** Entry points: every non-test module under `audio/live/`. */
function liveModules(): string[] {
  return readdirSync(LIVE, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        EXTENSIONS.includes(extname(entry.name)) &&
        !entry.name.includes('.test.'),
    )
    .map((entry) => join(LIVE, entry.name))
}

/** Resolves a relative specifier the way the bundler does, `.js` to `.ts` included. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = resolve(dirname(fromFile), specifier)
  const withoutJs = base.replace(/\.js$/, '')

  for (const candidate of [
    base,
    ...EXTENSIONS.map((ext) => `${withoutJs}${ext}`),
    ...EXTENSIONS.map((ext) => join(withoutJs, `index${ext}`)),
  ]) {
    if (EXTENSIONS.includes(extname(candidate)) && existsSync(candidate)) return candidate
  }
  return null
}

type Import = { specifier: string; typeOnly: boolean }

/** Static and dynamic imports, plus re-exports, which carry values too. */
function importsOf(file: string): Import[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const found: Import[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly === true,
      })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ specifier: node.moduleSpecifier.text, typeOnly: node.isTypeOnly })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, typeOnly: false })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Every module reachable from the entry points by a value import, plus any
 * offending path found on the way.
 */
function reachable(entries: readonly string[]): { visited: Set<string>; offenders: string[] } {
  const visited = new Set<string>()
  const offenders: string[] = []
  const queue = [...entries]
  const trail = new Map<string, string>()

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)

    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly) continue

      if (specifier === FORBIDDEN || specifier.startsWith(`${FORBIDDEN}/`)) {
        const chain: string[] = [asPosix(file)]
        let step = trail.get(file)
        while (step !== undefined) {
          chain.unshift(asPosix(step))
          step = trail.get(step)
        }
        offenders.push(`${chain.join(' -> ')} -> ${specifier}`)
        continue
      }

      const next = resolveSpecifier(file, specifier)
      if (next !== null && !visited.has(next)) {
        trail.set(next, file)
        queue.push(next)
      }
    }
  }

  return { visited, offenders }
}

describe('ambient capture never reaches the inference library (issue #219)', () => {
  it('finds modules to scan, so an empty pass means something', () => {
    const entries = liveModules()
    expect(
      entries.length,
      'scanned almost nothing under audio/live; the walk is broken or the tree moved',
    ).toBeGreaterThan(3)

    // The module that made this guard necessary must actually be an entry.
    expect(entries.map(asPosix)).toContain('frontend/src/audio/live/live-fold.ts')
  })

  it('follows imports past the first hop', () => {
    const { visited } = reachable(liveModules())
    const seen = [...visited].map(asPosix)

    // `live-fold.ts` imports `../draft-turns.js`, so a one-hop check would miss
    // anything that module goes on to reach.
    expect(seen).toContain('frontend/src/audio/draft-turns.ts')
  })

  it('reaches no path into the inference library', () => {
    const { offenders } = reachable(liveModules())

    expect(
      offenders,
      'a module under audio/live can now reach @huggingface/transformers by a ' +
        'value import. protocol.ts measured that at 458 kB to 982 kB on the main ' +
        'chunk, and ambient capture is the surface a doctor waits on.',
    ).toEqual([])
  })

  it('would catch a value import, and ignores an erased one', () => {
    const probe = (line: string) => {
      const source = ts.createSourceFile('probe.ts', line, ts.ScriptTarget.Latest, true)
      const found: Import[] = []
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          found.push({
            specifier: node.moduleSpecifier.text,
            typeOnly: node.importClause?.isTypeOnly === true,
          })
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      return found
    }

    expect(probe(`import { pipeline } from '${FORBIDDEN}'`)[0]?.typeOnly).toBe(false)
    expect(probe(`import type { Pipeline } from '${FORBIDDEN}'`)[0]?.typeOnly).toBe(true)
  })
})
