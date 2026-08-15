import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GAP_CHECKLIST } from '../gaps/index.js'
import { ALL_REDFLAG_TRIGGERS } from '../redflags/index.js'

/**
 * Issue #16, acceptance criteria 3 and 4. Clinical content is versioned data;
 * this fails the build when a piece of it is written down somewhere else.
 *
 * The failure it exists to stop is not a style problem. A `ruleId === '...'`
 * branch in a route or a component is a clinical rule that no version stamp
 * describes, so "what rules were active when this note was approved?" stops
 * having an answer, and updating the rule list silently leaves the copy behind.
 *
 * Scope is deliberately narrow, because a guard that cries wolf gets deleted:
 *
 * 1. **Whole single-quoted literals** equal to a trigger or checklist id.
 *    Biome pins `quoteStyle: 'single'` (biome.json), so a string in code is
 *    always single-quoted, while the same word in a comment or inside prompt
 *    prose is not. That one distinction is what keeps `analysis/prompt.ts`,
 *    which discusses the "diagnosis" field at length, from tripping this.
 * 2. **Guideline scoring-system names.** These carry the thresholds the two
 *    Malaysian sources disagree on (docs/trd.md §11), so a hard-coded one is
 *    a manufactured consensus with nothing citing it.
 *
 * The id set is read from the data at runtime rather than listed here. A
 * hand-maintained copy would be the same duplication this test forbids.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Where clinical content is allowed to be written down. */
const VERSIONED_DATA_FILES = [
  'backend/src/redflags/triggers.ts',
  'backend/src/gaps/checklist.ts',
  'backend/src/guidelines/corpus.ts',
]

const SCANNED_TREES = [
  { dir: 'backend/src', extensions: ['.ts'] },
  { dir: 'frontend/src', extensions: ['.ts', '.tsx'] },
]

const SCORING_SYSTEMS = /\b(centor|mcisaac)\b/i

// ALL_REDFLAG_TRIGGERS, not REDFLAG_TRIGGERS: the UTI ids were unguarded for
// as long as the scan read only the URTI list (issue #150, folded nit).
const CLINICAL_IDS = [
  ...ALL_REDFLAG_TRIGGERS.map((trigger) => trigger.id),
  ...GAP_CHECKLIST.map((entry) => entry.id),
]

/**
 * Tests assert against the data by design, and fixtures are synthetic clinical
 * text by design. Neither is a rule the application reads.
 */
function isExempt(path: string): boolean {
  return (
    VERSIONED_DATA_FILES.includes(path) ||
    path.startsWith('backend/src/fixtures/') ||
    /\.test\.tsx?$/.test(path)
  )
}

function sourceFiles(): string[] {
  const found: string[] = []

  for (const { dir, extensions } of SCANNED_TREES) {
    const walk = (absolute: string) => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const child = join(absolute, entry.name)
        if (entry.isDirectory()) {
          walk(child)
        } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
          found.push(relative(REPO_ROOT, child).replaceAll('\\', '/'))
        }
      }
    }

    walk(join(REPO_ROOT, dir))
  }

  return found
}

function violations(match: (line: string) => boolean): string[] {
  const found: string[] = []

  for (const path of sourceFiles()) {
    if (isExempt(path)) continue

    const lines = readFileSync(join(REPO_ROOT, path), 'utf8').split('\n')
    lines.forEach((line, index) => {
      if (match(line)) found.push(`${path}:${index + 1}: ${line.trim()}`)
    })
  }

  return found
}

describe('clinical constants live only in the versioned data files (issue #16)', () => {
  it('finds source to scan in both workspaces, so an empty pass means something', () => {
    const scanned = sourceFiles()

    expect(scanned.some((path) => path.startsWith('backend/src/'))).toBe(true)
    expect(scanned.some((path) => path.startsWith('frontend/src/'))).toBe(true)
    expect(CLINICAL_IDS.length).toBeGreaterThan(0)
  })

  it('defines no red-flag trigger or checklist id outside its data file', () => {
    const literals = CLINICAL_IDS.map((id) => `'${id}'`)

    expect(
      violations((line) => literals.some((literal) => line.includes(literal))),
      'A clinical rule is written down outside the versioned data. Branch on data read ' +
        'from ALL_REDFLAG_TRIGGERS or GAP_CHECKLIST, or move the behaviour into the entry itself.',
    ).toEqual([])
  })

  it('names no guideline scoring system outside the versioned data', () => {
    expect(
      violations((line) => SCORING_SYSTEMS.test(line)),
      'A guideline scoring system is named outside the corpus, where no version stamp ' +
        'covers it and the two Malaysian sources disagree. Render it from a GUIDELINE_CORPUS ' +
        'chunk instead.',
    ).toEqual([])
  })
})
