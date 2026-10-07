import type { ClinicalScore, GuidelineChunk } from '@shared/types'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScoreCard } from './ScoreCard.js'

/**
 * The scores are the doctor's (#221). The card asks each question once, shows
 * what the transcript plainly said beside the item without selecting it, and
 * sums each score from its own items against its own source. It never reads a
 * total for them.
 */

const YES_NO = [
  { id: 'yes', label: 'Yes', points: 1 },
  { id: 'no', label: 'No', points: 0 },
]

const FEVER = {
  id: 'fever',
  label: 'Fever',
  options: YES_NO,
  suggestion: { optionId: 'yes', evidence: 'Temperature 38.6' },
}
const NODES = { id: 'nodes', label: 'Tender nodes', options: YES_NO, suggestion: null }
const AGE = {
  id: 'age',
  label: 'Age',
  options: [
    { id: 'younger', label: 'Under 45', points: 0 },
    { id: 'older', label: '45 or older', points: -1 },
  ],
  suggestion: null,
}

const SCORES: ClinicalScore[] = [
  {
    id: 'first',
    name: 'First Synthetic Score',
    version: 'v1',
    guidelineIds: ['doc:guide-a'],
    items: [FEVER, NODES],
  },
  {
    id: 'second',
    name: 'Second Synthetic Score',
    version: 'v1',
    guidelineIds: ['doc:guide-b'],
    items: [FEVER, NODES, AGE],
  },
]

const guide = (id: string, title: string): GuidelineChunk => ({
  id,
  title,
  publisher: 'Synthetic Publisher',
  year: 2024,
  url: 'https://example.org/guide',
  summary: '',
  sourceLicence: 'all-rights-reserved',
  verbatimAllowed: false,
})
const GUIDES = [guide('guide-a', 'Guide A'), guide('guide-b', 'Guide B')]

afterEach(cleanup)

const group = (label: string) => screen.getByRole('radiogroup', { name: label })
const checked = (label: string, option: RegExp) =>
  (within(group(label)).getByRole('radio', { name: option }) as HTMLInputElement).checked
const total = (scoreId: string) => screen.getByTestId(`score-total-${scoreId}`).textContent

describe('ScoreCard (#221)', () => {
  it('asks a question two scores share only once', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3)
  })

  it('selects nothing for the doctor, and shows what was heard beside the item', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)

    for (const label of ['Fever', 'Tender nodes', 'Age']) {
      for (const radio of within(group(label)).getAllByRole('radio')) {
        expect((radio as HTMLInputElement).checked).toBe(false)
      }
    }
    expect(screen.getByText(/Temperature 38\.6/)).toBeTruthy()
    expect(screen.getByText(/0 of 2 answered/i)).toBeTruthy()
    expect(total('first')).toBe('0')
  })

  it('uses a suggestion only when the doctor taps it', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)

    fireEvent.click(screen.getByRole('button', { name: /use .yes. for fever/i }))

    expect(checked('Fever', /yes/i)).toBe(true)
    expect(total('first')).toBe('1')
    expect(screen.queryByRole('button', { name: /use .yes. for fever/i })).toBeNull()
  })

  it('sums each score from its own items, negative points included', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)

    fireEvent.click(within(group('Fever')).getByRole('radio', { name: /yes/i }))
    fireEvent.click(within(group('Tender nodes')).getByRole('radio', { name: /yes/i }))
    fireEvent.click(within(group('Age')).getByRole('radio', { name: /45 or older/i }))

    expect(total('first')).toBe('2')
    expect(total('second')).toBe('1')
  })

  it('lets the doctor answer against a suggestion', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)

    fireEvent.click(within(group('Fever')).getByRole('radio', { name: /no/i }))

    expect(checked('Fever', /no/i)).toBe(true)
    expect(total('first')).toBe('0')
    expect(screen.getByRole('button', { name: /use .yes. for fever/i })).toBeTruthy()
  })

  it('attributes each total to its own source, and interprets nothing', () => {
    render(<ScoreCard scores={SCORES} guidelines={GUIDES} />)

    fireEvent.click(screen.getByRole('button', { name: /source for first synthetic score/i }))
    expect(screen.getByText('Guide A')).toBeTruthy()
    expect(screen.queryByText('Guide B')).toBeNull()
    expect(document.body.textContent).not.toMatch(
      /antibiotic|likely|probability|diagnos(?:is|e)\b|recommend/i,
    )
  })

  it('keeps two cards on one page independent', () => {
    render(
      <>
        <ScoreCard scores={SCORES} guidelines={GUIDES} />
        <ScoreCard scores={SCORES} guidelines={GUIDES} />
      </>,
    )
    const [first, second] = screen.getAllByRole('radiogroup', { name: 'Fever' })
    if (first === undefined || second === undefined) throw new Error('expected two cards')

    fireEvent.click(within(first).getByRole('radio', { name: /no/i }))

    expect((within(first).getByRole('radio', { name: /no/i }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((within(second).getByRole('radio', { name: /no/i }) as HTMLInputElement).checked).toBe(
      false,
    )
  })
})
