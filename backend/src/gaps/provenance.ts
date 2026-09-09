import type { ConsultationAnalysis, GapSource, InformationGap } from '@shared/types'
import { ALL_GAP_CHECKLIST } from './checklist.js'

const CHECKLIST_BY_ID = new Map(ALL_GAP_CHECKLIST.map((entry) => [entry.id, entry]))

function withGapSource(gap: InformationGap): InformationGap {
  if (gap.source !== undefined) return { ...gap }

  const entry = CHECKLIST_BY_ID.get(gap.id)
  if (entry === undefined) return { ...gap }

  const source: GapSource =
    entry.source.kind === 'guideline'
      ? { kind: 'guideline', guidelineIds: [...entry.source.guidelineIds] }
      : { kind: 'unsourced', reason: entry.source.reason }

  return { ...gap, source }
}

export function withGapProvenance(
  analysis: ConsultationAnalysis | null,
): ConsultationAnalysis | null {
  if (analysis === null) return null
  return { ...analysis, gaps: analysis.gaps.map(withGapSource) }
}
