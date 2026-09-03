import type { ClinicalAssertion, ClinicalFacts, OperationalBlock } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChecklistPanel } from './ChecklistPanel.js'

afterEach(cleanup)

const notAssessed: ClinicalAssertion = { state: 'NOT_ASSESSED' }

const OPERATIONAL: OperationalBlock = {
  diagnosis: notAssessed,
  medicationsDispensed: [],
  mcDays: notAssessed,
  referral: notAssessed,
  followUp: notAssessed,
}

/**
 * `soreThroat` carries a long value alongside its badge; every other field is
 * bare `NOT_ASSESSED`, badge only. The two shapes need opposite CSS on `dd`
 * (see `ChecklistPanel.tsx`), which is exactly what broke twice while fixing
 * a reported horizontal-scrollbar regression: a fix for one shape reliably
 * overflowed the other. jsdom does not lay out CSS, so this cannot measure
 * pixels; it pins the class the component emits for each shape instead, which
 * is the thing a future edit would actually change.
 */
const facts = (soreThroat: ClinicalAssertion): ClinicalFacts => ({
  symptoms: {
    cough: notAssessed,
    coughDuration: notAssessed,
    sputumProduction: notAssessed,
    sputumCharacteristics: notAssessed,
    haemoptysis: notAssessed,
    soreThroat,
    fever: notAssessed,
    dyspnoea: notAssessed,
    chestPain: notAssessed,
    swallowingDifficulty: notAssessed,
    oralIntake: notAssessed,
    onsetAndProgression: notAssessed,
  },
  history: {
    asthma: notAssessed,
    copd: notAssessed,
    cardiacDisease: notAssessed,
    immunosuppression: notAssessed,
    smoking: notAssessed,
    recentInfectionExposure: notAssessed,
    currentMedications: notAssessed,
    drugAllergies: notAssessed,
  },
  observations: {
    temperature: notAssessed,
    heartRate: notAssessed,
    respiratoryRate: notAssessed,
    bloodPressure: notAssessed,
    oxygenSaturation: notAssessed,
  },
  examination: {
    throat: notAssessed,
    tonsillar: notAssessed,
    cervicalLymphNodes: notAssessed,
    chest: notAssessed,
  },
})

describe('the checklist row never overflows its column', () => {
  /*
   * A row with a value needs `dd` to shrink (`min-w-0`), so the value span can
   * absorb the squeeze via `truncate` rather than the row overflowing at a
   * flat `max-w-[10rem]` regardless of how narrow the column actually is.
   * Without `min-w-0` on `dd` here, this shape overflowed its column by 169px
   * at the width the reported bug was measured at.
   */
  it('lets dd shrink when a value sits beside the badge', () => {
    render(
      <ChecklistPanel
        clinicalFacts={facts({
          state: 'PRESENT',
          value: 'Severe sore throat, inability to swallow',
          evidence: 'tekak saya sakit sangat',
        })}
        operational={OPERATIONAL}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /completeness checklist/i }))

    const dd = screen.getByText('Severe sore throat, inability to swallow').closest('dd')
    expect(dd?.className).toContain('min-w-0')
  })

  /*
   * A badge-only row (no value at all) is the opposite case: `dd`'s only
   * child is the badge, which is `shrink-0` and must never truncate a
   * clinical state word. There, `min-w-0` on `dd` removes the floor that
   * keeps it at the badge's own width, and the badge overflows instead. This
   * shape overflowed by 21px the first time `dd` unconditionally carried
   * `min-w-0`, at a column width where the valued row above was already
   * fixed.
   */
  it('does not give dd min-w-0 when there is no value to absorb it', () => {
    render(<ChecklistPanel clinicalFacts={facts(notAssessed)} operational={OPERATIONAL} />)
    fireEvent.click(screen.getByRole('button', { name: /completeness checklist/i }))

    const badge = screen.getAllByText('Not Assessed')[0]
    const dd = badge?.closest('dd')
    expect(dd?.className).not.toContain('min-w-0')
  })
})
