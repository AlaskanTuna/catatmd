import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CITABLE_DOCUMENT_IDS, parseDocumentRef } from '../guidelines/documents.js'
import { ALL_GAP_CHECKLIST, GapChecklistSourceSchema } from './checklist.js'

describe('gap checklist provenance', () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../corpus/cpg/manifest.json', import.meta.url)),
      'utf8',
    ),
  ) as { documents: { id: string; profiles: string[] }[] }

  const manifestDocuments = new Map(manifest.documents.map((document) => [document.id, document]))

  it('rejects a document reference to an uncitable id', () => {
    expect(
      GapChecklistSourceSchema.safeParse({
        kind: 'guideline',
        guidelineIds: ['doc:invented-document-id'],
      }).success,
    ).toBe(false)
  })

  it('makes every entry explicitly cited or explicitly unsourced', () => {
    for (const entry of ALL_GAP_CHECKLIST) {
      const parsed = GapChecklistSourceSchema.safeParse(entry.source)

      expect(parsed.success, `${entry.id} has invalid or missing provenance`).toBe(true)
      if (!parsed.success || parsed.data.kind === 'unsourced') continue

      for (const guidelineId of parsed.data.guidelineIds) {
        const parsedRef = parseDocumentRef(guidelineId)
        expect(parsedRef, `${entry.id} cites unparseable reference ${guidelineId}`).not.toBeNull()
        if (parsedRef === null) continue

        expect(
          CITABLE_DOCUMENT_IDS.includes(
            parsedRef.documentId as (typeof CITABLE_DOCUMENT_IDS)[number],
          ),
          `${entry.id} cites uncitable document ${parsedRef.documentId}`,
        ).toBe(true)

        const document = manifestDocuments.get(parsedRef.documentId)
        expect(document, `${entry.id} cites missing document ${parsedRef.documentId}`).toBeDefined()
        expect(
          entry.profiles.every((profileId) => document?.profiles.includes(profileId)),
          `${entry.id} cites a document that does not cover every entry profile`,
        ).toBe(true)
      }
    }
  })

  const ALLOWED_UNSOURCED_URTI_IDS: readonly string[] = [
    'haemoptysis',
    'smoking',
    'current-medications',
    'drug-allergies',
    'diagnosis',
    'mc-days',
    'referral',
    'follow-up',
  ]

  it('grounds every non-administrative adult-acute-urti prompt in a guideline', () => {
    for (const entry of ALL_GAP_CHECKLIST) {
      if (!entry.profiles.includes('adult-acute-urti')) continue
      if (ALLOWED_UNSOURCED_URTI_IDS.includes(entry.id)) continue

      expect(entry.source.kind, `${entry.id} must be sourced from a guideline`).toBe('guideline')
    }
  })
})
