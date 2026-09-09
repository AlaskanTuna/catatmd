import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CITABLE_DOCUMENT_IDS, documentRef, parseDocumentRef } from './documents.js'

describe('citable documents', () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../corpus/cpg/manifest.json', import.meta.url)),
      'utf8',
    ),
  ) as { documents: { id: string }[] }

  const manifestIds = new Set(manifest.documents.map((document) => document.id))

  it('contains only document ids that exist in the CPG manifest', () => {
    for (const id of CITABLE_DOCUMENT_IDS) {
      expect(manifestIds.has(id)).toBe(true)
    }
  })

  it('produces a doc: reference without a page', () => {
    expect(documentRef('moh-nag-2024')).toBe('doc:moh-nag-2024')
  })

  it('produces a doc: reference with a page', () => {
    expect(documentRef('moh-nag-2024', 12)).toBe('doc:moh-nag-2024#p12')
  })

  it('parses a reference without a page', () => {
    expect(parseDocumentRef('doc:moh-nag-2024')).toEqual({ documentId: 'moh-nag-2024' })
  })

  it('parses a reference with a page', () => {
    expect(parseDocumentRef('doc:moh-nag-2024#p12')).toEqual({
      documentId: 'moh-nag-2024',
      page: 12,
    })
  })

  it('rejects a reference with a non-positive page', () => {
    expect(parseDocumentRef('doc:moh-nag-2024#p0')).toBeNull()
  })

  it('rejects a reference that is not a doc: reference', () => {
    expect(parseDocumentRef('moh-nag-2024')).toBeNull()
    expect(parseDocumentRef('doc:')).toBeNull()
  })
})
