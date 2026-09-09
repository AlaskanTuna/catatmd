import type {
  ClinicalSuggestion,
  ConsultationAnalysis,
  InformationGap,
  RedFlag,
} from '@shared/types'
import type { CitableDocumentId } from './documents.js'
import { documentRef } from './documents.js'

export const LEGACY_TO_DOCUMENT: Record<string, CitableDocumentId> = {
  'moh-nag-2024-a10-modified-centor': 'moh-nag-2024',
  'moh-nag-2024-c1-acute-pharyngitis': 'moh-nag-2024',
  'moh-nag-2024-c1-viral-vs-bacterial': 'moh-nag-2024',
  'moh-nag-2024-c3-acute-bronchitis': 'moh-nag-2024',
  'moh-nag-2024-c4-uncomplicated-urti': 'moh-nag-2024',
  'moh-nag-2024-acute-uti-scope': 'moh-nag-2024',
  'abdullah-2024-mcisaac-criteria': 'abdullah-2024-idr-sore-throat',
  'abdullah-2024-mcisaac-threshold': 'abdullah-2024-idr-sore-throat',
  'abdullah-2024-safety-netting': 'abdullah-2024-idr-sore-throat',
  'ooi-2022-urti-epidemiology': 'ooi-2022-mfp-urti',
  'ooi-2022-antibiotic-prescribing-patterns': 'ooi-2022-mfp-urti',
}

export function modernizeCitationId(id: string): string {
  const documentId = LEGACY_TO_DOCUMENT[id]
  return documentId ? documentRef(documentId) : id
}

function deduplicate<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function modernizeList(ids: readonly string[]): string[] {
  return deduplicate(ids.map(modernizeCitationId))
}

function withLegacyRedFlag(flag: RedFlag): RedFlag {
  if (!Array.isArray(flag.guidelineIds)) return flag
  return { ...flag, guidelineIds: modernizeList(flag.guidelineIds) }
}

function withLegacyGap(gap: InformationGap): InformationGap {
  if (gap.source?.kind !== 'guideline') return gap
  return {
    ...gap,
    source: {
      ...gap.source,
      guidelineIds: modernizeList(gap.source.guidelineIds),
    },
  }
}

function withLegacySuggestion(suggestion: ClinicalSuggestion): ClinicalSuggestion {
  if (!Array.isArray(suggestion.citations)) return suggestion

  const seen = new Set<string>()
  const citations = suggestion.citations
    .map((citation) => ({ ...citation, guidelineId: modernizeCitationId(citation.guidelineId) }))
    .filter((citation) => {
      if (seen.has(citation.guidelineId)) return false
      seen.add(citation.guidelineId)
      return true
    })

  // The model's prose carried the chunk id in square brackets; a dead id in
  // front of a doctor is worse than none, so it is rewritten to the same
  // reference the chip resolves.
  const text = suggestion.text.replace(/\[([a-z0-9-]+)\]/g, (match, id: string) =>
    id in LEGACY_TO_DOCUMENT ? `[${modernizeCitationId(id)}]` : match,
  )

  return { ...suggestion, text, citations }
}

export function withLegacyCitations(
  analysis: ConsultationAnalysis | null,
): ConsultationAnalysis | null {
  if (analysis === null || typeof analysis !== 'object') return analysis

  return {
    ...analysis,
    redFlags: analysis.redFlags.map(withLegacyRedFlag),
    gaps: analysis.gaps.map(withLegacyGap),
    suggestions: analysis.suggestions.map(withLegacySuggestion),
  }
}
