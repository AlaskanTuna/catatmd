import type { Disposition, GuidelineChunk, InformationGap, RedFlag } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GapCard, RedFlagCard, SuggestionCard } from './SafetyCards.js'

/**
 * The disposition control shows two buttons at rest rather than three.
 *
 * What matters is that reducing the resting state did not reduce what the
 * doctor can do. All three decisions must stay reachable, the alternatives must
 * expand in place rather than hide behind a menu that could fail to open, and
 * dismissing must still demand a reason — that last one is a clinical-safety
 * property, not a form nicety.
 */

const FLAG: RedFlag = {
  id: 'rf-1',
  ruleId: 'exertional-dyspnoea',
  severity: 'urgent',
  label: 'Exertional Breathlessness',
  evidence: 'rasa sesak bila naik tangga',
  source: 'rule',
}

afterEach(cleanup)

function renderCard(disposition?: Disposition) {
  const onDecide = vi.fn()
  render(<RedFlagCard flag={FLAG} disposition={disposition} onDecide={onDecide} guidelines={[]} />)
  return onDecide
}

describe('RedFlagCard disposition control', () => {
  it('shows one primary action and one disclosure at rest', () => {
    renderCard()

    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /more options/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^dismiss$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /not applicable/i })).toBeNull()
  })

  it('acknowledges without needing the disclosure', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))

    expect(onDecide).toHaveBeenCalledWith({ id: 'rf-1', state: 'acknowledged' })
  })

  it('keeps both alternatives one press away', () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))

    expect(screen.getByRole('button', { name: /^dismiss$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /not applicable/i })).toBeTruthy()
  })

  it('marks the disclosure as expanded for assistive technology', () => {
    renderCard()
    const toggle = screen.getByRole('button', { name: /more options/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(
      screen.getByRole('button', { name: /fewer options/i }).getAttribute('aria-expanded'),
    ).toBe('true')
  })

  it('records not-applicable through the disclosure', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /not applicable/i }))

    expect(onDecide).toHaveBeenCalledWith({ id: 'rf-1', state: 'not_applicable' })
  })

  it('still demands a reason before a dismissal is recorded', () => {
    const onDecide = renderCard()

    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }))

    // The reason field appears and nothing has been decided yet.
    expect(screen.getByRole('textbox')).toBeTruthy()
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('never offers a decision control once one has been recorded', () => {
    renderCard({
      id: 'rf-1',
      state: 'acknowledged',
      decidedAt: new Date('2026-08-27T06:00:00.000Z'),
    })

    expect(screen.queryByRole('button', { name: /more options/i })).toBeNull()
  })
})

/**
 * The card supplies the quotation marks, so a model that also quoted its
 * evidence rendered as doubled quotes on screen. Observed in production on
 * 27/08/26: `Heard: ""sesak bila naik tangga""`.
 *
 * Stripped on render rather than on ingest, deliberately. The stored value has
 * to stay byte-identical to what the model returned, because the audit trail
 * and the evidence check both read it.
 */
describe('evidence quoting', () => {
  it('does not double the quotation marks the model supplied', () => {
    render(
      <RedFlagCard
        flag={{ ...FLAG, evidence: '"sesak bila naik tangga"' }}
        disposition={undefined}
        onDecide={vi.fn()}
        guidelines={[]}
      />,
    )

    expect(screen.getByText(/sesak bila naik tangga/).textContent).not.toContain('""')
  })

  it('strips curly quotes as well as straight ones', () => {
    render(
      <RedFlagCard
        flag={{ ...FLAG, evidence: '“rasa sesak”' }}
        disposition={undefined}
        onDecide={vi.fn()}
        guidelines={[]}
      />,
    )

    expect(screen.getByText(/rasa sesak/).textContent).not.toContain('““')
  })

  it('leaves a quote inside the phrase alone', () => {
    render(
      <RedFlagCard
        flag={{ ...FLAG, evidence: 'he said "sesak" twice' }}
        disposition={undefined}
        onDecide={vi.fn()}
        guidelines={[]}
      />,
    )

    expect(screen.getByText(/twice/).textContent).toContain('"sesak"')
  })
})

describe('RedFlagCard sources panel', () => {
  const GUIDELINES: GuidelineChunk[] = [
    {
      id: 'my-moh-2024',
      title: 'Malaysian Ministry of Health Cough Guideline',
      publisher: 'MOH',
      year: 2024,
      url: 'https://example.com/my-moh-2024',
      summary: 'Summary',
      sourceLicence: 'All rights reserved',
      verbatimAllowed: false,
    },
    {
      id: 'my-nice-2023',
      title: 'NICE Sore Throat Guideline',
      publisher: 'NICE',
      year: 2023,
      url: 'https://example.com/my-nice-2023',
      summary: 'Summary',
      sourceLicence: 'CC-BY',
      verbatimAllowed: true,
      quote: 'A quote that should not render.',
    },
    {
      id: 'who-2022',
      title: 'WHO Respiratory Infections',
      publisher: 'WHO',
      year: 2022,
      url: 'https://example.com/who-2022',
      summary: 'Summary',
      sourceLicence: 'CC-BY',
      verbatimAllowed: true,
    },
  ]

  function renderWithGuidelines(flag: RedFlag) {
    return render(
      <RedFlagCard
        flag={flag}
        disposition={undefined}
        onDecide={vi.fn()}
        guidelines={GUIDELINES}
      />,
    )
  }

  it('shows both titles for two resolvable guidelineIds', () => {
    renderWithGuidelines({ ...FLAG, guidelineIds: ['my-moh-2024', 'who-2022'] })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('Malaysian Ministry of Health Cough Guideline')).toBeTruthy()
    expect(screen.getByText('WHO Respiratory Infections')).toBeTruthy()
    expect(screen.getAllByText('Open Guideline')).toHaveLength(2)
  })

  it('shows exactly "No guideline citation." for an empty guidelineIds array', () => {
    renderWithGuidelines({ ...FLAG, guidelineIds: [] })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('No guideline citation.')).toBeTruthy()
  })

  it('shows exactly "No guideline citation." for a model-sourced flag', () => {
    const modelFlag: RedFlag = { ...FLAG, source: 'model' }
    renderWithGuidelines(modelFlag)
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('No guideline citation.')).toBeTruthy()
  })

  it('skips an unresolvable guidelineId without rendering a broken row', () => {
    renderWithGuidelines({ ...FLAG, guidelineIds: ['my-moh-2024', 'not-a-real-id'] })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('Malaysian Ministry of Health Cough Guideline')).toBeTruthy()
    expect(screen.queryByText('not-a-real-id')).toBeNull()
    expect(screen.getAllByText('Open Guideline')).toHaveLength(1)
  })

  it('does not render a quote even when the matching chunk carries one', () => {
    renderWithGuidelines({ ...FLAG, guidelineIds: ['my-nice-2023'] })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('NICE Sore Throat Guideline')).toBeTruthy()
    expect(screen.queryByText('A quote that should not render.')).toBeNull()
  })

  it('does not render the sources panel until Sources is clicked', () => {
    renderWithGuidelines({ ...FLAG, guidelineIds: ['my-moh-2024'] })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))

    expect(screen.queryByText('Malaysian Ministry of Health Cough Guideline')).toBeNull()
    expect(screen.queryByText('No guideline citation.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('Malaysian Ministry of Health Cough Guideline')).toBeTruthy()
  })
})

/**
 * Retrieved CPG chunks carry fields the curated corpus never sets: the page a
 * span was lifted from, and an OCR flag when the page was a scan. The link has
 * to land on that page, and the note has to say the text may carry
 * recognition errors, because both are the provenance a doctor checks a
 * citation against.
 */
describe('retrieved CPG chunks', () => {
  const RETRIEVED: GuidelineChunk = {
    id: 'cpg-cough-p12',
    title: 'Management of Acute Cough in Adults',
    publisher: 'MOH Malaysia',
    year: 2024,
    url: 'https://example.com/cpg-cough.pdf',
    summary: 'A retrieved span.',
    sourceLicence: 'All rights reserved',
    verbatimAllowed: false,
    documentId: 'cpg-cough',
    page: 12,
    ocr: true,
  }

  function openSourcesPanel(chunk: GuidelineChunk) {
    render(
      <RedFlagCard
        flag={{ ...FLAG, guidelineIds: [chunk.id] }}
        disposition={undefined}
        onDecide={vi.fn()}
        guidelines={[chunk]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))
  }

  function openCitation(chunk: GuidelineChunk) {
    render(
      <SuggestionCard
        suggestion={{
          id: 's-1',
          text: 'A suggestion for review.',
          citations: [{ guidelineId: chunk.id }],
        }}
        guidelines={[chunk]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: chunk.id }))
  }

  it('links a sources-panel citation to the page the span came from', () => {
    openSourcesPanel(RETRIEVED)

    const link = screen.getByRole('link', { name: 'Open source, p. 12' })
    expect(link.getAttribute('href')).toBe('https://example.com/cpg-cough.pdf#page=12')
  })

  it('links a suggestion citation the same way', () => {
    openCitation(RETRIEVED)

    const link = screen.getByRole('link', { name: 'Open source, p. 12' })
    expect(link.getAttribute('href')).toBe('https://example.com/cpg-cough.pdf#page=12')
  })

  it('warns when the span was recovered by OCR', () => {
    openCitation(RETRIEVED)

    expect(
      screen.getByText('Text recovered by OCR from a scanned page; verify against the source.'),
    ).toBeTruthy()
  })

  it('clamps a long retrieved span behind a disclosure', () => {
    openCitation({ ...RETRIEVED, summary: 'a span of guideline text '.repeat(30) })

    const toggle = screen.getByRole('button', { name: 'Show more' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('renders a short summary without a toggle', () => {
    openCitation(RETRIEVED)

    expect(screen.getByText('A retrieved span.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull()
  })
})

describe('GapCard sources panel', () => {
  const GUIDELINES: GuidelineChunk[] = [
    {
      id: 'my-moh-2024',
      title: 'Malaysian Ministry of Health Cough Guideline',
      publisher: 'MOH',
      year: 2024,
      url: 'https://example.com/my-moh-2024',
      summary: 'Summary',
      sourceLicence: 'All rights reserved',
      verbatimAllowed: false,
    },
  ]

  const GAP: InformationGap = {
    id: 'fever',
    question: 'Has the patient had a fever?',
    rationale: 'Fever status is not documented in this consultation.',
    priority: 'medium',
  }

  function renderGap(gap: InformationGap) {
    return render(
      <GapCard gap={gap} disposition={undefined} onDecide={vi.fn()} guidelines={GUIDELINES} />,
    )
  }

  it('shows the cited chunk id for a guideline-sourced gap', () => {
    renderGap({ ...GAP, source: { kind: 'guideline', guidelineIds: ['my-moh-2024'] } })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('my-moh-2024')).toBeTruthy()
    expect(screen.queryByText('No guideline citation.')).toBeNull()
  })

  it('shows the stated reason for an unsourced gap', () => {
    renderGap({ ...GAP, source: { kind: 'unsourced', reason: 'Payer record field.' } })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('Payer record field.')).toBeTruthy()
    expect(screen.queryByText('No guideline citation.')).toBeNull()
  })

  it('shows a checklist chip and the reason for an unsourced gap', () => {
    renderGap({ ...GAP, source: { kind: 'unsourced', reason: 'Payer record field.' } })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('record checklist')).toBeTruthy()
    expect(screen.getByText('Payer record field.')).toBeTruthy()
    expect(screen.queryByText('No guideline citation.')).toBeNull()
  })

  it('shows unresolvable guideline ids as chips for a guideline-sourced gap', () => {
    renderGap({ ...GAP, source: { kind: 'guideline', guidelineIds: ['not-in-list'] } })
    fireEvent.click(screen.getByRole('button', { name: /more options/i }))
    fireEvent.click(screen.getByRole('button', { name: /sources/i }))

    expect(screen.getByText('not-in-list')).toBeTruthy()
    expect(screen.queryByText('No guideline citation.')).toBeNull()
  })
})
