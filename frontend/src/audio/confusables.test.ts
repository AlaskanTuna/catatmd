import { describe, expect, it } from 'vitest'
import { applyConfusable, findConfusables } from './confusables.js'

describe('findConfusables', () => {
  it.each([
    ['patut', 'batuk'],
    ['patuk', 'batuk'],
    ['teman', 'demam'],
    ['tenggi', 'denggi'],
    ['tanggi', 'denggi'],
    ['sempuk', 'semput'],
    ['pengkat', 'bengkak'],
    ['penkak', 'bengkak'],
    ['kekak', 'tekak'],
    ['tongso', 'tonsil'],
    ['tongsel', 'tonsil'],
  ])('hints the measured pair %s to %s', (found, suggestion) => {
    expect(findConfusables(`ada ${found} sikit`)).toEqual([
      { start: 4, end: 4 + found.length, found, suggestion },
    ])
  })

  it('preserves the leading capital of the token it flags', () => {
    expect(findConfusables('Patut sudah empat hari.')).toEqual([
      { start: 0, end: 5, found: 'Patut', suggestion: 'Batuk' },
    ])
  })

  it('flags whole tokens only, never words containing one', () => {
    expect(findConfusables('sepatutnya berpatutan tema temanku')).toEqual([])
  })

  it('returns one hint per occurrence, each at its own offset', () => {
    const hints = findConfusables('patut tadi, patut lagi')
    expect(hints).toHaveLength(2)
    expect(hints[0]).toMatchObject({ start: 0, end: 5 })
    expect(hints[1]).toMatchObject({ start: 12, end: 17 })
  })
})

describe('applyConfusable', () => {
  it('replaces only the tapped occurrence', () => {
    const text = 'patut tadi, patut lagi'
    const second = findConfusables(text)[1]
    if (!second) throw new Error('expected a second hint')
    expect(applyConfusable(text, second)).toBe('patut tadi, batuk lagi')
  })

  it('returns the text unchanged when the hint no longer matches', () => {
    const hint = findConfusables('patut sudah')[0]
    if (!hint) throw new Error('expected a hint')
    expect(applyConfusable('typed over completely', hint)).toBe('typed over completely')
  })
})
