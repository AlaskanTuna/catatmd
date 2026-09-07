import type { InformationGap, RedFlag } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { LivePanes } from '../audio/live/use-live-panes.js'
import { PROMPT_LIMIT, selectPrompts } from './live-prompt.js'

const panes = (over: Partial<LivePanes> = {}): LivePanes => ({
  redFlags: [],
  gaps: [],
  answered: [],
  clinicalFacts: null,
  operational: null,
  hasContent: false,
  flagsChecked: true,
  flagsStalled: false,
  ...over,
})

const gap = (id: string, priority: InformationGap['priority']): InformationGap => ({
  id,
  question: `${id}?`,
  rationale: `because ${id}`,
  priority,
})

const flag = (id: string, severity: RedFlag['severity']): RedFlag => ({
  id,
  label: id,
  severity,
  evidence: 'said so',
  source: 'rule',
})

const none = { asked: [], skipped: [] }

describe('selectPrompts, red flags', () => {
  it('reports clear only when a check has actually run', () => {
    expect(selectPrompts(panes({ flagsChecked: true }), none).flags).toEqual({ kind: 'clear' })
  })

  it('never claims clear before the first check', () => {
    expect(selectPrompts(panes({ flagsChecked: false }), none).flags).toEqual({ kind: 'unchecked' })
  })

  it('never claims clear while the check is stalled', () => {
    const model = selectPrompts(panes({ flagsChecked: true, flagsStalled: true }), none)
    expect(model.flags).toEqual({ kind: 'stalled' })
  })

  it('shows a hit even when the check is stalled, rather than hiding it', () => {
    const model = selectPrompts(
      panes({ redFlags: [flag('a', 'urgent')], flagsStalled: true, flagsChecked: false }),
      none,
    )
    expect(model.flags.kind).toBe('flags')
  })

  it('orders emergency ahead of urgent ahead of advisory', () => {
    const model = selectPrompts(
      panes({
        redFlags: [flag('c', 'advisory'), flag('a', 'emergency'), flag('b', 'urgent')],
      }),
      none,
    )
    expect(model.flags.kind === 'flags' && model.flags.flags.map((f) => f.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('selectPrompts, gaps', () => {
  it('caps what is shown however many exist', () => {
    const many = Array.from({ length: 27 }, (_, i) => gap(`g${i}`, 'high'))
    const model = selectPrompts(panes({ gaps: many }), none)
    expect(model.ask).toHaveLength(PROMPT_LIMIT)
    expect(model.outstanding).toHaveLength(27)
  })

  it('orders by priority without filtering any priority out', () => {
    const model = selectPrompts(
      panes({ gaps: [gap('low', 'low'), gap('high', 'high'), gap('mid', 'medium')] }),
      none,
    )
    expect(model.ask.map((g) => g.id)).toEqual(['high', 'mid', 'low'])
  })

  it('shows low priority gaps when they are all there is', () => {
    const model = selectPrompts(panes({ gaps: [gap('only', 'low')] }), none)
    expect(model.ask.map((g) => g.id)).toEqual(['only'])
  })

  it('sends a skipped gap to the back without dropping it', () => {
    const gaps = [gap('a', 'high'), gap('b', 'high'), gap('c', 'high'), gap('d', 'high')]
    const model = selectPrompts(panes({ gaps }), { asked: [], skipped: ['a'] })
    expect(model.ask.map((g) => g.id)).toEqual(['b', 'c', 'd'])
    expect(model.outstanding.map((g) => g.id)).toContain('a')
  })

  it('takes an asked gap out of rotation but keeps it in the count', () => {
    const gaps = [gap('a', 'high'), gap('b', 'high')]
    const model = selectPrompts(panes({ gaps }), { asked: ['a'], skipped: [] })
    expect(model.ask.map((g) => g.id)).toEqual(['b'])
    expect(model.outstanding).toHaveLength(2)
  })

  it('does not mutate the panes it was handed', () => {
    const gaps = [gap('b', 'low'), gap('a', 'high')]
    const input = panes({ gaps, redFlags: [flag('y', 'advisory'), flag('x', 'emergency')] })
    selectPrompts(input, none)
    expect(input.gaps.map((g) => g.id)).toEqual(['b', 'a'])
    expect(input.redFlags.map((f) => f.id)).toEqual(['y', 'x'])
  })
})
