import type {
  ClinicalAssertion,
  ClinicalFacts,
  EvidenceLink,
  OperationalBlock,
} from '@shared/types'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChecklistPanel } from './ChecklistPanel.js'

afterEach(cleanup)

const dialogProto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
const originalShowModal = dialogProto.showModal
const originalClose = dialogProto.close

beforeEach(() => {
  dialogProto.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  dialogProto.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close', { bubbles: false, cancelable: false }))
  }
})

afterEach(() => {
  if (originalShowModal === undefined) delete dialogProto.showModal
  else dialogProto.showModal = originalShowModal
  if (originalClose === undefined) delete dialogProto.close
  else dialogProto.close = originalClose
})

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

describe('the checklist follows the canonical record projection', () => {
  it('groups fields by canonical section and omits empty family history', () => {
    render(
      <ChecklistPanel
        clinicalFacts={facts(notAssessed)}
        operational={{
          ...OPERATIONAL,
          medicationsDispensed: [
            { state: 'PRESENT', value: 'Amoxicillin', evidence: 'amoxicillin supplied' },
          ],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /completeness checklist/i }))

    const sectionContaining = (label: string) =>
      screen.getByText(label).closest('section')?.textContent ?? ''

    expect(sectionContaining('Cough')).toContain('Presenting Complaint')
    expect(sectionContaining('Sore Throat')).toContain('Presenting Complaint')
    expect(sectionContaining('Cough Duration')).toContain('History of Presenting Complaint')
    expect(sectionContaining('Asthma')).toContain('Past Medical History')
    expect(sectionContaining('Smoking')).toContain('Social History')
    expect(sectionContaining('Temperature')).toContain('Objective')
    expect(sectionContaining('Throat')).toContain('Objective')
    expect(sectionContaining('Diagnosis')).toContain('Assessment')
    expect(sectionContaining('Mc Days')).toContain('Plan')
    expect(sectionContaining('Referral')).toContain('Plan')
    expect(sectionContaining('Follow Up')).toContain('Plan')
    expect(sectionContaining('Dispensed:')).toContain('Plan')
    expect(screen.queryByRole('heading', { name: 'Family History' })).toBeNull()
  })
})

describe('the completeness checklist dialog', () => {
  const openChecklistDialog = async () => {
    render(<ChecklistPanel clinicalFacts={facts(notAssessed)} operational={OPERATIONAL} />)
    fireEvent.click(screen.getByRole('button', { name: 'Completeness Checklist' }))
    return screen.findByRole('dialog', { name: 'Completeness Checklist' })
  }

  it('exposes a full-width CTA and no accessible dialog before it is clicked', () => {
    render(<ChecklistPanel clinicalFacts={facts(notAssessed)} operational={OPERATIONAL} />)

    const cta = screen.getByRole('button', { name: 'Completeness Checklist' })
    expect(cta.className).toContain('w-full')
    expect(cta.getAttribute('data-tour')).toBe('checklist')
    expect(cta.getAttribute('data-print')).toBe('hide')
    expect(cta.hasAttribute('aria-expanded')).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a native labelled dialog with the glass-panel sizing contract', async () => {
    const dialog = await openChecklistDialog()

    expect(dialog.tagName).toBe('DIALOG')
    expect((dialog as HTMLDialogElement).open).toBe(true)
    expect(dialog.className).toContain('glass-panel')
    expect(dialog.className).toContain('h-[min(85vh,48rem)]')
    expect(dialog.className).toContain('w-[min(56rem,calc(100vw-2rem))]')
    expect(dialog.className).toContain('max-w-none')
  })

  it('renders one scrollable sunken body with all 33 rows and the establishment count', async () => {
    const dialog = await openChecklistDialog()

    const scrollBodies = dialog.querySelectorAll('.overflow-y-auto.bg-sunken')
    expect(scrollBodies).toHaveLength(1)
    expect(scrollBodies[0]?.querySelectorAll('dd')).toHaveLength(33)
    expect(within(dialog).getByText('0 of 33 established')).toBeTruthy()
  })

  it('focuses the Close button on open and closes the dialog when it is activated', async () => {
    const dialog = await openChecklistDialog()

    const closeButton = within(dialog).getByRole('button', { name: /close/i })
    await waitFor(() => expect(document.activeElement).toBe(closeButton))

    fireEvent.click(closeButton)
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false))
  })

  it('keeps the single checklist body mounted inside the closed dialog for print', () => {
    render(<ChecklistPanel clinicalFacts={facts(notAssessed)} operational={OPERATIONAL} />)

    const dialog = document.querySelector('dialog')
    expect(dialog?.open).toBe(false)
    expect(dialog?.getAttribute('data-print')).toBe('block')
    expect(document.querySelectorAll('.overflow-y-auto.bg-sunken')).toHaveLength(1)
    expect(dialog?.querySelectorAll('dd')).toHaveLength(33)
  })

  it('expands an interactive row to show transcript evidence, speaker and timestamp', async () => {
    const evidenceLinks: EvidenceLink[] = [
      {
        fieldId: 'clinicalFacts.symptoms.soreThroat',
        state: 'PRESENT',
        evidence: 'tekak saya sakit sangat',
        speaker: 'patient',
        offsetSeconds: 15,
      },
    ]

    render(
      <ChecklistPanel
        clinicalFacts={facts({
          state: 'PRESENT',
          value: 'Severe sore throat, inability to swallow',
          evidence: 'tekak saya sakit sangat',
        })}
        operational={OPERATIONAL}
        evidenceLinks={evidenceLinks}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Completeness Checklist' }))
    const dialog = await screen.findByRole('dialog', { name: 'Completeness Checklist' })

    const row = within(dialog).getByRole('button', {
      name: /show the transcript source for sore throat/i,
    })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(within(dialog).queryByText(/tekak saya sakit sangat/)).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(within(dialog).getByText(/tekak saya sakit sangat/)).toBeTruthy()
    expect(within(dialog).getByText('Patient · 0:15')).toBeTruthy()
  })

  it('synchronises React state when the dialog is closed so it can be reopened', async () => {
    render(<ChecklistPanel clinicalFacts={facts(notAssessed)} operational={OPERATIONAL} />)
    const cta = screen.getByRole('button', { name: 'Completeness Checklist' })

    fireEvent.click(cta)
    const dialog = await screen.findByRole('dialog', { name: 'Completeness Checklist' })
    expect((dialog as HTMLDialogElement).open).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((dialog as HTMLDialogElement).open).toBe(false)

    fireEvent.click(cta)
    const reopened = await screen.findByRole('dialog', { name: 'Completeness Checklist' })
    expect(reopened).toBe(dialog)
    expect((reopened as HTMLDialogElement).open).toBe(true)
  })
})
