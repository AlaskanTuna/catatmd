import { describe, expect, it } from 'vitest'
import {
  chunkPage,
  cleanPage,
  computeRunningHeaders,
  findHeadings,
  findManifestMatch,
  isScannedPage,
  normalise,
  parseFlags,
  resolveDocumentFields,
} from './ingest-cpg.js'

function manifest(): {
  source: string
  publisher: string
  jurisdiction: string
  sourceLicence: string
  verbatimAllowed: boolean
  documents: {
    id: string
    title: string
    year: number
    sourceUrl: string
    file: string | null
    profiles: string[]
  }[]
} {
  return {
    source: 'https://example.com',
    publisher: 'Test Publisher',
    jurisdiction: 'MY',
    sourceLicence: 'test',
    verbatimAllowed: true,
    documents: [
      {
        id: 'amm-cpg-284',
        title: 'Management of Sore Throat',
        year: 2003,
        sourceUrl: 'https://www.acadmed.org.my/view_file.cfm?fileid=284',
        file: null,
        profiles: [],
      },
      {
        id: 'amm-cpg-342',
        title: 'Management of Cancer Pain (2nd Edition)',
        year: 2023,
        sourceUrl: 'https://www.acadmed.org.my/view_file.cfm?fileid=342',
        file: null,
        profiles: [],
      },
      {
        id: 'amm-cpg-748',
        title: 'Management of Cervical Cancer (2nd Edition)',
        year: 2015,
        sourceUrl: 'https://www.acadmed.org.my/view_file.cfm?fileid=748',
        file: null,
        profiles: [],
      },
    ],
  }
}

describe('parseFlags', () => {
  it('parses --only, --dry-run, --skip-upload and --force', () => {
    const flags = parseFlags([
      'node',
      'script.ts',
      '--only',
      'amm-cpg-284',
      '--only',
      'amm-cpg-342',
      '--dry-run',
      '--skip-upload',
      '--force',
    ])
    expect(flags.only).toEqual(['amm-cpg-284', 'amm-cpg-342'])
    expect(flags.dryRun).toBe(true)
    expect(flags.skipUpload).toBe(true)
    expect(flags.force).toBe(true)
  })
})

describe('normalise', () => {
  it('strips punctuation and filler words', () => {
    const s = normalise('Management of Sore Throat (2nd Edition)')
    expect(s).toBe('sore throat')
  })

  it('removes ordinals and the word the', () => {
    expect(normalise('The 3rd Management of the Asthma')).toBe('asthma')
  })
})

describe('findManifestMatch', () => {
  it('matches by the file field', () => {
    const m = manifest()
    const first = m.documents[0]
    if (!first) throw new Error('missing first document')
    first.file = 'sore_throat.pdf'
    const doc = findManifestMatch('sore_throat.pdf', null, m)
    expect(doc?.id).toBe('amm-cpg-284')
  })

  it('matches by a numeric fileid in the filename', () => {
    const doc = findManifestMatch('cpg_342_downloaded.pdf', null, manifest())
    expect(doc?.id).toBe('amm-cpg-342')
  })

  it('matches by normalised title against the filename stem', () => {
    const doc = findManifestMatch('Sore Throat 2003.pdf', null, manifest())
    expect(doc?.id).toBe('amm-cpg-284')
  })

  it('matches by normalised title against first page text', () => {
    const firstPage = 'Cervical Cancer Management 2nd Edition\n\nSome body text here.'
    const doc = findManifestMatch('unknown.pdf', firstPage, manifest())
    expect(doc?.id).toBe('amm-cpg-748')
  })

  it('returns null when nothing matches', () => {
    const doc = findManifestMatch(
      'completely_unknown_name.pdf',
      'irrelevant page content',
      manifest(),
    )
    expect(doc).toBeNull()
  })

  it('prefers the longest title when several are contained in the first page', () => {
    const m = manifest()
    const firstPage = 'Management of Cervical Cancer (2nd Edition) and other text'
    const doc = findManifestMatch('x.pdf', firstPage, m)
    expect(doc?.id).toBe('amm-cpg-748')
  })
})

describe('isScannedPage', () => {
  it('flags pages with fewer than 80 non-whitespace characters', () => {
    expect(isScannedPage('   12   34   ')).toBe(true)
    expect(isScannedPage('a'.repeat(79))).toBe(true)
    expect(isScannedPage('a'.repeat(80))).toBe(false)
  })
})

describe('computeRunningHeaders', () => {
  it('identifies a line appearing on more than 30% of pages', () => {
    const pages = [
      'Guideline Title\nSome body',
      'Guideline Title\nMore body',
      'Guideline Title\nEven more',
    ]
    const headers = computeRunningHeaders(pages)
    expect(headers.has('guideline title')).toBe(true)
  })

  it('does not treat page numbers as running headers', () => {
    const pages = ['1\nfirst body', '2\nsecond body', '3\nthird body']
    const headers = computeRunningHeaders(pages)
    expect(headers.size).toBe(0)
  })
})

describe('cleanPage', () => {
  it('de-hyphenates lower-case words across line ends', () => {
    const raw = 'A hyphenated-\nword ends here.\nAnother line.'
    const out = cleanPage(raw, new Set())
    expect(out).toContain('hyphenatedword')
    expect(out).toContain('Another line')
  })

  it('does not de-hyphenate when the join would not be lower-case', () => {
    const raw = 'A proper-\nName here.\nNext line.'
    const out = cleanPage(raw, new Set())
    expect(out).not.toContain('properName')
  })

  it('drops page-number-only lines', () => {
    const raw = '12\nSome real content.\n13'
    const out = cleanPage(raw, new Set())
    expect(out).not.toContain('12')
    expect(out).not.toContain('13')
    expect(out).toContain('Some real content')
  })

  it('drops repeated running headers', () => {
    const raw = 'Running Header\nBody text.'
    const out = cleanPage(raw, new Set(['running header']))
    expect(out).not.toContain('Running Header')
    expect(out).toContain('Body text')
  })

  it('collapses whitespace and preserves paragraph breaks', () => {
    const raw = 'Line   one  here.\n\nLine  two  here.'
    const out = cleanPage(raw, new Set())
    expect(out).toBe('Line one here.\n\nLine two here.')
  })
})

describe('findHeadings', () => {
  it('detects all-uppercase, numbered and RECOMMENDATION N headings', () => {
    const text = 'INTRODUCTION\n\n3.2\n\nRECOMMENDATION 4\n\nSome body text.'
    const headings = findHeadings(text)
    expect(headings.map((h) => h.text)).toEqual(['INTRODUCTION', '3.2', 'RECOMMENDATION 4'])
  })

  it('rejects headings that end with a full stop or are too long', () => {
    const text = `Not a heading.\n\n${'A'.repeat(90)}\n\nSome body.`
    const headings = findHeadings(text)
    expect(headings).toEqual([])
  })
})

describe('chunkPage', () => {
  const docId = 'amm-cpg-test'

  it('never exceeds 1200 characters and never spans pages', () => {
    const body = 'word '.repeat(500)
    const { chunks } = chunkPage(body, 1, docId, 1)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200)
      expect(c.page).toBe(1)
    }
  })

  it('carries a 150-character overlap into the next chunk', () => {
    const body = 'token '.repeat(500)
    const { chunks } = chunkPage(body, 1, docId, 1)
    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i]
      const next = chunks[i + 1]
      if (!current || !next) continue
      const tail = current.text.slice(-150)
      expect(next.text.startsWith(tail)).toBe(true)
    }
  })

  it('assigns ordinals from startOrdinal and does not span pages', () => {
    const { chunks, nextOrdinal } = chunkPage('token '.repeat(500), 3, docId, 7)
    const first = chunks[0]
    const second = chunks[1]
    expect(first?.ordinal).toBe(7)
    expect(second?.ordinal).toBe(8)
    expect(nextOrdinal).toBe(7 + chunks.length)
  })

  it('detects the nearest preceding heading for each chunk', () => {
    const text = `INTRODUCTION\n\n${'word '.repeat(200)}\n\n3.2\n\n${'token '.repeat(200)}`
    const { chunks } = chunkPage(text, 1, docId, 1)
    const first = chunks[0]
    expect(first?.heading).toBe('INTRODUCTION')
    expect(chunks.some((c) => c.heading === '3.2')).toBe(true)
  })

  it('drops chunks under 120 characters unless they are the only chunk', () => {
    const text = `INTRODUCTION\n\n${'word '.repeat(500)}`
    const { chunks } = chunkPage(text, 1, docId, 1)
    expect(chunks.every((c) => c.text.length >= 120 || chunks.length === 1)).toBe(true)
    expect(chunks.some((c) => c.heading === 'INTRODUCTION' && c.text.length >= 120)).toBe(true)
  })
})

describe('resolveDocumentFields', () => {
  const MANIFEST = {
    publisher: 'Ministry of Health Malaysia / Academy of Medicine of Malaysia',
    sourceLicence: 'MOH-CPG-unconfirmed',
    verbatimAllowed: true,
  }

  it('inherits the manifest values when the document states none', () => {
    expect(resolveDocumentFields({}, MANIFEST)).toEqual(MANIFEST)
  })

  it('prefers the document values over the manifest', () => {
    expect(
      resolveDocumentFields(
        { publisher: 'Malaysian Family Physician', sourceLicence: 'CC-BY-4.0' },
        MANIFEST,
      ),
    ).toEqual({
      publisher: 'Malaysian Family Physician',
      sourceLicence: 'CC-BY-4.0',
      verbatimAllowed: true,
    })
  })

  /*
   * The case the fields exist for. `retrieve.ts` sets `summary: chunk.text`,
   * so `verbatimAllowed: false` is what keeps an all-rights-reserved span from
   * reaching the doctor as a quotable citation. A `false` must survive a
   * permissive manifest rather than being read as absent.
   */
  it('lets a document forbid verbatim reuse under a permissive manifest', () => {
    expect(
      resolveDocumentFields({ sourceLicence: 'MOH-ARR', verbatimAllowed: false }, MANIFEST),
    ).toEqual({
      publisher: MANIFEST.publisher,
      sourceLicence: 'MOH-ARR',
      verbatimAllowed: false,
    })
  })
})
