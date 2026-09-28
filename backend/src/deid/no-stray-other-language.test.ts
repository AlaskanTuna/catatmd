import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConsultationDetail, Transcript } from '@shared/types'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { renderDigest } from '../copilot/digest.js'
import { deidentifyTranscript, serialiseTranscript } from './index.js'

/**
 * The other-language half of a translated turn never reaches a model (#392,
 * docs/trd.md §20.12).
 *
 * It is Bengali or Urdu script, and no detector in this directory reads
 * either: a name written in it would pass the gate untouched, and
 * `assertNoIdentifiers` would find nothing to refuse. So the guarantee cannot
 * be that de-identification handles it. It is that nothing ever hands it over,
 * pinned twice:
 *
 * 1. **Behaviourally**, on every function that turns a stored transcript into
 *    model-bound text: `serialiseTranscript`, which `deidentifyTranscript` and
 *    therefore analysis, live analysis and transcript cleanup all go through,
 *    and the copilot digest, which renders its own lines.
 * 2. **Structurally**, by keeping the field name out of backend source
 *    altogether. The API stores the transcript and never needs to read this
 *    field, so any reference is a new reader worth a review. Resolved from the
 *    AST, as the sibling `no-stray-*` guards are, so a comment explaining the
 *    rule cannot trip it.
 *
 * **The structural half matches the name, and that is its limit.** A spread of
 * a whole turn, or a stringified transcript, would carry the field without
 * naming it. What catches the script itself on any such route is the `SCRIPT`
 * detector (#391), which tokenises it at the gate and which
 * `assertNoIdentifiers` re-runs at egress.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const MARKER = 'MARKER_OTHER_LANGUAGE_7731'

/** Synthetic throughout, per AGENTS.md. */
const translated: Transcript = {
  source: 'asr_live',
  labelsReviewed: false,
  machineTranslation: { languages: ['bn'] },
  turns: [
    {
      speaker: 'doctor',
      text: 'What is your name, please?',
      otherLanguage: { language: 'bn', text: `আপনার নাম কী? ${MARKER}`, spoken: false },
    },
    {
      speaker: 'patient',
      text: 'My name is Rahim Uddin.',
      otherLanguage: { language: 'bn', text: `আমার নাম রহিম উদ্দিন। ${MARKER}`, spoken: true },
    },
  ],
}

/** Bengali, Arabic (Urdu) and Devanagari: the scripts no detector reads. */
const UNREADABLE_SCRIPT = /[ঀ-৿؀-ۿऀ-ॿ]/u

describe('the other language never reaches model-bound text', () => {
  it('is absent from the serialised transcript that analysis, live analysis and cleanup send', () => {
    const serialised = serialiseTranscript(translated)
    expect(serialised).not.toContain(MARKER)
    expect(serialised).not.toMatch(UNREADABLE_SCRIPT)
  })

  it('is absent after de-identification too', () => {
    const { text } = deidentifyTranscript(translated)
    expect(text).not.toContain(MARKER)
    expect(text).not.toMatch(UNREADABLE_SCRIPT)
  })

  it('is absent from the copilot digest', () => {
    const detail = {
      id: 'c1',
      status: 'analysed',
      createdAt: new Date('2026-09-28T00:00:00Z'),
      updatedAt: new Date('2026-09-28T00:00:00Z'),
      approvedAt: null,
      approvedBy: null,
      editedNote: null,
      acknowledgedRedFlagIds: [],
      reviewedGapIds: [],
      redFlagDispositions: [],
      gapDispositions: [],
      transcript: translated,
      analysis: null,
    } as unknown as ConsultationDetail

    const digest = renderDigest(detail)
    expect(digest).not.toContain(MARKER)
    expect(digest).not.toMatch(UNREADABLE_SCRIPT)
  })
})

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

  walk(join(REPO_ROOT, 'backend/src'))
  return found
}

/** Every identifier or string literal spelling the field, with its location. */
function readersOf(field: string, paths: readonly string[]): string[] {
  const found: string[] = []

  for (const path of paths) {
    const text = readFileSync(join(REPO_ROOT, path), 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

    const visit = (node: ts.Node) => {
      const names =
        (ts.isIdentifier(node) && node.text === field) ||
        (ts.isStringLiteralLike(node) && node.text === field)
      if (names) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        found.push(`${path}:${line}`)
      }
      ts.forEachChild(node, visit)
    }

    visit(source)
  }

  return found
}

describe('backend source never reads the other language (#392)', () => {
  it('finds source to scan, so an empty pass means something', () => {
    expect(sourceFiles().length).toBeGreaterThan(50)
  })

  it('names otherLanguage nowhere outside tests', () => {
    expect(readersOf('otherLanguage', sourceFiles())).toEqual([])
  })
})
