import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioCapture } from './AudioCapture.js'
import { AudioSettingsDialog } from './AudioSettingsDialog.js'
import { DEFAULT_AUDIO_SETTINGS } from './audio-settings.js'

vi.mock('../lib/api.js', () => ({
  api: { transcribeHostedAsr: vi.fn(), draftHostedTurns: vi.fn() },
}))

afterEach(cleanup)

/*
 * Opened, not merely rendered. A closed `<dialog>` is `display: none`, so
 * everything inside it is out of the accessibility tree and every `getByRole`
 * here would pass by finding nothing at all.
 *
 * Opened by the attribute rather than by `showModal()`, which this jsdom does
 * not implement. The attribute is what the UA stylesheet keys on, which is the
 * only part of the difference these assertions can see.
 */
function renderDialog() {
  const ref = createRef<HTMLDialogElement>()
  render(<AudioSettingsDialog ref={ref} settings={DEFAULT_AUDIO_SETTINGS} onApply={vi.fn()} />)
  act(() => ref.current?.setAttribute('open', ''))
}

/*
 * The dialog had no test at all, which is how it kept telling the doctor
 * "Either way, each patient is asked before anything is kept" for three weeks
 * after #228 removed the thing that asked. The claim was never wrong in
 * isolation: it went wrong because the control it described was deleted
 * somewhere else and nothing connected the two.
 */
describe('the Audio dialog and the control it describes', () => {
  it('says consent is per patient, and is only allowed to while a per-patient control exists', () => {
    renderDialog()
    const claim = screen.getByText(/each patient is asked/i)
    expect(claim.textContent).toMatch(/never remembered/i)

    // The other half of the same sentence, rendered from the screen the
    // sentence points at. These two assertions must live in one test: split
    // apart, either half can be deleted while the other keeps passing, which
    // is exactly the failure this file exists to prevent.
    cleanup()
    render(<AudioCapture onTranscript={vi.fn()} engine="hosted" transcript="" />)
    expect(screen.getByRole('checkbox', { name: /agreed/i })).toBeTruthy()
  })

  it('carries no consent control of its own, because everything here is remembered', () => {
    renderDialog()

    // A remembered agreement is one the patient after the consenting one never
    // gave. A reader must not leave this dialog believing they have agreed to
    // anything on a patient's behalf.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('promises no ambient listening while ambient capture is not built', () => {
    renderDialog()

    const ambient = screen.getByRole('button', { name: /ambient/i }) as HTMLButtonElement
    expect(ambient.disabled).toBe(true)
    expect(screen.getByText(/not built yet/i)).toBeTruthy()
    expect(screen.queryByText(/listens for the whole session/i)).toBeNull()
  })

  it('claims no label review, which was removed with the review gate', () => {
    renderDialog()

    // The tip promised labels "you review line by line before anything enters
    // the transcript" for three days after #233 deleted that step.
    expect(screen.queryByText(/review line by line/i)).toBeNull()
  })
})
