import type { InformationGap, RedFlag } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LivePanes } from '../audio/live/use-live-panes.js'
import { LivePrompter } from './LivePrompter.js'

afterEach(cleanup)

const panes = (over: Partial<LivePanes> = {}): LivePanes => ({
  redFlags: [],
  gaps: [],
  answered: [],
  clinicalFacts: null,
  operational: null,
  hasContent: true,
  flagsChecked: true,
  flagsStalled: false,
  ...over,
})

const gap = (id: string, priority: InformationGap['priority'] = 'high'): InformationGap => ({
  id,
  question: `Ask about ${id}?`,
  rationale: `because ${id}`,
  priority,
})

const flag = (id: string, severity: RedFlag['severity']): RedFlag => ({
  id,
  label: `${id} label`,
  severity,
  evidence: 'said so',
  source: 'rule',
})

const show = (over: Partial<LivePanes> = {}) =>
  render(<LivePrompter live={panes(over)} onShowAll={() => {}} />)

describe('LivePrompter, the safety claim', () => {
  it('says none detected only when a check has run', () => {
    show({ flagsChecked: true })
    expect(screen.getByText(/none detected/i)).toBeDefined()
  })

  it('never says none detected before the first check', () => {
    show({ flagsChecked: false })
    expect(screen.queryByText(/none detected/i)).toBeNull()
    expect(screen.getByText(/waiting for the first safety check/i)).toBeDefined()
  })

  it('never says none detected while the check is stalled', () => {
    show({ flagsChecked: true, flagsStalled: true })
    expect(screen.queryByText(/none detected/i)).toBeNull()
    expect(screen.getByText(/live safety checks have stopped/i)).toBeDefined()
  })

  it('shows a hit even when the check is stalled', () => {
    show({ redFlags: [flag('a', 'urgent')], flagsStalled: true, flagsChecked: false })
    expect(screen.getByText('a label')).toBeDefined()
    expect(screen.queryByText(/waiting for the first safety check/i)).toBeNull()
  })

  it('carries the severity word alongside the colour', () => {
    show({ redFlags: [flag('a', 'emergency')] })
    expect(screen.getByText('Emergency')).toBeDefined()
  })
})

describe('LivePrompter, the prompts', () => {
  it('shows at most three however many exist', () => {
    const many = Array.from({ length: 27 }, (_, i) => gap(`g${i}`))
    show({ gaps: many })
    expect(screen.getAllByText(/^Ask about g\d+\?$/)).toHaveLength(3)
  })

  it('counts every outstanding gap, not just the three shown', () => {
    show({ gaps: Array.from({ length: 27 }, (_, i) => gap(`g${i}`)) })
    expect(screen.getByText('Show All 27')).toBeDefined()
    expect(screen.getByText('3 of 27')).toBeDefined()
  })

  it('takes an asked prompt out of rotation without changing the count', () => {
    show({ gaps: [gap('a'), gap('b'), gap('c'), gap('d')] })
    expect(screen.getByText('Ask about a?')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Asked' }))

    expect(screen.queryByText('Ask about a?')).toBeNull()
    expect(screen.getByText('Ask about d?')).toBeDefined()
    // Saying it out loud is not the record establishing it, so nothing is
    // subtracted from the outstanding list.
    expect(screen.getByText('Show All 4')).toBeDefined()
  })

  it('sends a skipped prompt to the back rather than removing it', () => {
    show({ gaps: [gap('a'), gap('b'), gap('c'), gap('d')] })

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.getByText('Ask about b?')).toBeDefined()
    expect(screen.queryByText('Ask about a?')).toBeNull()
    expect(screen.getByText('Show All 4')).toBeDefined()
  })

  it('disables both controls when there is nothing to act on', () => {
    show({ gaps: [] })
    expect(screen.getByRole('button', { name: 'Asked' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Skip' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens the full list on request', () => {
    const onShowAll = vi.fn()
    render(<LivePrompter live={panes({ gaps: [gap('a')] })} onShowAll={onShowAll} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show All 1' }))
    expect(onShowAll).toHaveBeenCalledOnce()
  })
})
