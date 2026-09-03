import type { ClinicalSuggestion, GuidelineChunk } from '@shared/types'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SourcesDialog } from './SourcesDialog.js'

const GUIDELINES: GuidelineChunk[] = [
  {
    id: 'MOH-2024-URTI',
    title: 'Acute URTI',
    publisher: 'Ministry of Health Malaysia',
    year: 2024,
    url: 'https://example.com/urti',
    summary: 'A summary of the URTI guideline.',
    sourceLicence: 'All rights reserved',
    verbatimAllowed: false,
  },
  {
    id: 'MOH-2024-COUGH',
    title: 'Chronic Cough',
    publisher: 'Malaysian Family Physician',
    year: 2023,
    url: 'https://example.com/cough',
    summary: 'A summary of the cough guideline.',
    sourceLicence: 'CC-BY',
    verbatimAllowed: true,
    quote: 'A quote that should never be shown.',
  },
  {
    id: 'NICE-2020-COUGH',
    title: 'NICE Cough',
    publisher: 'NICE',
    year: 2020,
    url: 'https://example.com/nice',
    summary: 'A summary of the NICE guideline.',
    sourceLicence: 'OGL',
    verbatimAllowed: true,
  },
]

afterEach(cleanup)

/*
 * jsdom 27 still ships `<dialog>` without `showModal` or `close`. The stand-ins
 * only need to move the `open` attribute, which is what makes the contents
 * visible to queries, and to fire `close`, which is what the acknowledgement
 * reset listens for.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

function open(suggestions: ClinicalSuggestion[], outOfScope: boolean | undefined) {
  render(
    <SourcesDialog suggestions={suggestions} guidelines={GUIDELINES} outOfScope={outOfScope} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Sources/ }))
  return screen.getByRole('dialog')
}

describe('SourcesDialog', () => {
  it('lists a guideline cited by two suggestions once and shows count 1', () => {
    const suggestions: ClinicalSuggestion[] = [
      { id: 's1', text: 'Suggestion 1', citations: [{ guidelineId: 'MOH-2024-URTI' }] },
      { id: 's2', text: 'Suggestion 2', citations: [{ guidelineId: 'MOH-2024-URTI' }] },
    ]
    render(<SourcesDialog suggestions={suggestions} guidelines={GUIDELINES} outOfScope={false} />)

    expect(screen.getByText('Sources 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Sources/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('Acute URTI').length).toBe(1)
  })

  it('lists every cited source with its publisher and year', () => {
    const suggestions: ClinicalSuggestion[] = [
      {
        id: 's1',
        text: 'Suggestion 1',
        citations: [{ guidelineId: 'MOH-2024-URTI' }, { guidelineId: 'MOH-2024-COUGH' }],
      },
      { id: 's2', text: 'Suggestion 2', citations: [{ guidelineId: 'MOH-2024-URTI' }] },
    ]
    const dialog = open(suggestions, false)

    expect(within(dialog).getByText('Acute URTI')).toBeTruthy()
    expect(within(dialog).getByText('Chronic Cough')).toBeTruthy()
    expect(within(dialog).getByText('Ministry of Health Malaysia · 2024')).toBeTruthy()
    expect(within(dialog).getByText('Malaysian Family Physician · 2023')).toBeTruthy()
  })

  it('does not list a corpus entry that was not cited', () => {
    const suggestions: ClinicalSuggestion[] = [
      { id: 's1', text: 'Suggestion 1', citations: [{ guidelineId: 'MOH-2024-URTI' }] },
    ]
    const dialog = open(suggestions, false)

    expect(within(dialog).queryByText('NICE Cough')).toBeNull()
  })
})

describe('empty state', () => {
  it('renders the out-of-scope sentence when outOfScope is true', () => {
    const dialog = open([], true)
    expect(
      within(dialog).getByText("Outside the guideline corpus's scope, so no guideline was cited."),
    ).toBeTruthy()
  })

  it('renders the in-scope sentence when outOfScope is false', () => {
    const dialog = open([], false)
    expect(
      within(dialog).getByText(
        "Within the guideline corpus's scope, with nothing to cite for this consultation.",
      ),
    ).toBeTruthy()
  })

  it('renders the unknown-scope sentence when outOfScope is undefined', () => {
    const dialog = open([], undefined)
    expect(
      within(dialog).getByText(
        'This consultation was analysed before scope was recorded, so whether the corpus applied is not known.',
      ),
    ).toBeTruthy()
  })
})

it('does not render a quote even when the corpus chunk carries one', () => {
  const suggestions: ClinicalSuggestion[] = [
    { id: 's1', text: 'Suggestion 1', citations: [{ guidelineId: 'MOH-2024-COUGH' }] },
  ]
  const dialog = open(suggestions, false)

  expect(within(dialog).getByText('Chronic Cough')).toBeTruthy()
  expect(within(dialog).queryByText('A quote that should never be shown.')).toBeNull()
})
