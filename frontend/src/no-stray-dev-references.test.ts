import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Internal document references must not reach a doctor's screen.
 *
 * A tooltip shipped reading "check those words when you review the draft (TRD
 * 20.3)". Everything in that sentence is true and the citation is real, but the
 * reader is a clinician who has no TRD, so the pointer resolves to nothing and
 * the copy reads as an internal note left in by accident, on the one screen
 * whose whole job is to say what the transcription can be trusted with.
 *
 * The reason this needs a guard rather than review is that the leak is written
 * by the same habit that makes the rest of the codebase good. Every comment
 * here cites its source, so citing one inside the adjacent string is a one
 * character slip, and it reads as correct in the diff.
 *
 * Scope is deliberately narrow, because a guard that cries wolf gets deleted:
 *
 * 1. **Comments are stripped first, and only then is code searched.** These
 *    references belong in comments and are load-bearing there. Only a surviving
 *    occurrence is in a string, a prop or a label, which is to say shipped.
 * 2. **Only unambiguous internal references**, listed below. Not a general
 *    prose linter.
 *
 * Comment stripping keeps `//` inside a string intact, so a URL cannot swallow
 * the rest of a line and hide a reference behind it.
 */
/*
 * Resolved from the working directory rather than from `import.meta.url`,
 * because this suite runs under jsdom, where that is not a `file:` URL and
 * `fileURLToPath` throws. Vitest runs from the workspace root.
 */
const SRC = join(process.cwd(), 'src')
const REPO_ROOT = join(process.cwd(), '..')

const EXTENSIONS = new Set(['.ts', '.tsx'])

const SKIPPED = new Set(['node_modules', 'dist'])

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bTRD\b/, why: 'the TRD is an internal document' },
  { pattern: /\bPRD\b/, why: 'the PRD is an internal document' },
  { pattern: /\bdocs\/[a-z-]+\.md\b/, why: 'a repo path means nothing to a doctor' },
  { pattern: /\b(?:backend|frontend|shared)\/src\b/, why: 'a source path is not user-facing' },
  { pattern: /§/, why: 'a section symbol only ever cites an internal document' },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : sourceFiles(full)
    return EXTENSIONS.has(extname(entry.name)) ? [full] : []
  })
}

/**
 * Removes comments while leaving string contents alone.
 *
 * Walks the file rather than running a regex over it, because the cases that
 * matter are precisely the ones a regex confuses: a `//` inside a string (a
 * URL) is not a comment, and a quote inside a comment (an apostrophe) does not
 * open a string.
 *
 * Regex literals are tracked for the same reason, and it is not hypothetical.
 * `audio/draft-turns.ts` splits sentences on `/([.!?]+)\s+(?=[A-Z0-9"'])/`,
 * whose character class holds one double quote and one apostrophe. Reading
 * those as string delimiters desynchronised everything after it, which left the
 * next block comment looking like string content and reported it as shipped
 * copy. A guard whose first run is a false positive is a guard nobody trusts.
 */
const REGEX_MAY_FOLLOW = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+'])

function stripComments(source: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null
  let lastCode = ''

  while (index < source.length) {
    // `charAt` rather than indexing: it is typed `string`, so the walker needs
    // no non-null assertion, and past the end it yields '' which matches every
    // comparison below being false.
    const char = source.charAt(index)
    const next = source.charAt(index + 1)

    if (quote !== null) {
      if (char === '\\') {
        out += '  '
        index += 2
        continue
      }
      if (char === quote) quote = null
      out += char
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      // Newlines are preserved so reported line numbers stay true.
      out += source.slice(index, stop).replace(/[^\n]/g, ' ')
      index = stop
      continue
    }

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      out += ' '.repeat(stop - index)
      index = stop
      continue
    }

    // A `/` in a position where a value may begin opens a regex literal, not a
    // division. Consumed whole, so quotes inside a character class stay inert.
    if (char === '/' && (lastCode === '' || REGEX_MAY_FOLLOW.has(lastCode))) {
      let scan = index + 1
      let inClass = false
      while (scan < source.length) {
        const current = source.charAt(scan)
        if (current === '\\') {
          scan += 2
          continue
        }
        if (current === '[') inClass = true
        else if (current === ']') inClass = false
        else if (current === '/' && !inClass) break
        else if (current === '\n') break
        scan += 1
      }
      out += source.slice(index, scan + 1).replace(/[^\n]/g, ' ')
      lastCode = '/'
      index = scan + 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') quote = char
    if (char.trim() !== '') lastCode = char
    out += char
    index += 1
  }

  return out
}

describe('no internal document references ship to the browser', () => {
  const files = sourceFiles(SRC).filter((file) => !file.endsWith('no-stray-dev-references.test.ts'))

  it('scans the frontend source tree', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('finds no internal reference outside a comment', () => {
    const found: string[] = []

    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, offset) => {
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(line)) {
            found.push(`${relative(REPO_ROOT, file)}:${offset + 1}, ${why}: ${line.trim()}`)
          }
        }
      })
    }

    expect(found).toEqual([])
  })

  it('reads a reference in a comment and a reference in a string differently', () => {
    const commented = stripComments("/* see docs/trd.md §20 */\nconst a = 'fine'\n")
    expect(commented).not.toMatch(/trd\.md/)
    expect(commented).toMatch(/fine/)

    const shipped = stripComments("const tip = 'check the draft (TRD 20.3)'\n")
    expect(shipped).toMatch(/TRD/)
  })

  it('does not mistake a URL inside a string for a comment', () => {
    const kept = stripComments("const url = 'https://example.test/a' // trailing\n")
    expect(kept).toMatch(/example\.test/)
    expect(kept).not.toMatch(/trailing/)
  })

  /*
   * The case that made the first run of this guard report a false positive.
   * Quotes inside a regex character class are not string delimiters, and
   * reading them as such desynchronises every comment after them.
   */
  it('does not read a quote inside a regex character class as a string', () => {
    const source = 'const B = /([.!?]+)\\s+(?=[A-Z0-9"\'])/g\n/* see docs/trd.md */\nconst a = 1\n'
    const stripped = stripComments(source)
    expect(stripped).not.toMatch(/trd\.md/)
    expect(stripped).toMatch(/const a = 1/)
  })

  it('keeps division working, so an expression is not eaten as a regex', () => {
    const stripped = stripComments("const ratio = width / height\nconst tag = 'kept'\n")
    expect(stripped).toMatch(/width \/ height/)
    expect(stripped).toMatch(/kept/)
  })
})
