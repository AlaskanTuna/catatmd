import type { ClinicalArtefactVersion } from '../clinical-versions/types.js'

/**
 * Version of the retrieval corpus: the ingested CPG manifest scope plus the
 * licence state of each document. Bumped when a document is added, removed,
 * or its licence/scope changes.
 */
export const GUIDELINE_CORPUS_VERSION: ClinicalArtefactVersion = {
  id: 'guideline-corpus-v5',
  effectiveDate: '2026-09-09',
}

/**
 * Document ids the deterministic layers (red-flag triggers, the gap
 * checklist) may cite with a `doc:` reference. The model never sees these:
 * its citable set is the retrieved chunk ids on the analysis, and a `doc:`
 * reference can never satisfy that enum, so it can cite a span but never a
 * whole document.
 *
 * These are the ingested source documents, not the curated chunk ids that live
 * in `corpus.ts`. A test in `documents.test.ts` asserts that every id here is
 * present in `corpus/cpg/manifest.json`, so a document missing from the
 * manifest fails at test time rather than rendering as a broken citation.
 */
export const CITABLE_DOCUMENT_IDS = [
  'moh-nag-2024',
  'abdullah-2024-idr-sore-throat',
  'ooi-2022-mfp-urti',
] as const

export type CitableDocumentId = (typeof CITABLE_DOCUMENT_IDS)[number]

export function documentRef(id: CitableDocumentId, page?: number): string {
  return page === undefined ? `doc:${id}` : `doc:${id}#p${page}`
}

export function parseDocumentRef(ref: string): { documentId: string; page?: number } | null {
  const match = ref.match(/^doc:([^#]+)(?:#p(\d+))?$/)
  if (!match) return null
  const [, documentId, pageString] = match
  if (documentId === undefined) return null
  if (pageString === undefined) return { documentId }
  const page = Number(pageString)
  if (!Number.isFinite(page) || !Number.isInteger(page) || page <= 0) return null
  return { documentId, page }
}
