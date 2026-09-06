import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioCapture } from './AudioCapture.js'
import { AudioSettingsDialog } from './AudioSettingsDialog.js'
import { DEFAULT_AUDIO_SETTINGS } from './audio-settings.js'
import { AmbientCapture } from './live/AmbientCapture.js'

const liveAsrConfig = vi.hoisted(() =>
  vi.fn(async () => ({
    provider: 'soniox',
    region: 'us',
    websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket',
    config: {
      model: 'stt-rt-v5',
      languageHints: ['ms', 'en', 'zh', 'ta'],
      languageIdentification: true,
      speakerDiarization: true,
      endpointDetection: true,
    },
  })),
)

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: {
    transcribeHostedAsr: vi.fn(),
    draftHostedTurns: vi.fn(),
    liveAsrConfig,
    createLiveSession: vi.fn(),
  },
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
    // Two paths send audio now, and each makes this claim about its own. Both
    // are asserted here because a claim is only allowed to stand while the
    // control it describes exists.
    const claims = screen.getAllByText(/each patient is asked/i)
    expect(claims).toHaveLength(2)
    for (const claim of claims) expect(claim.textContent).toMatch(/never remembered/i)

    // The other half of the same sentence, rendered from the screens the
    // sentence points at. These assertions must live in one test: split apart,
    // either half can be deleted while the other keeps passing, which is
    // exactly the failure this file exists to prevent.
    cleanup()
    render(<AudioCapture onTranscript={vi.fn()} engine="hosted" transcript="" />)
    expect(screen.getByRole('checkbox', { name: /agreed/i })).toBeTruthy()

    cleanup()
    render(
      <AmbientCapture onTranscript={vi.fn()} onSwitchToManual={vi.fn()} onLiveChange={vi.fn()} />,
    )
    return waitFor(() => expect(screen.getByRole('checkbox', { name: /agreed/i })).toBeTruthy())
  })

  it('carries no consent control of its own, because everything here is remembered', () => {
    renderDialog()

    // A remembered agreement is one the patient after the consenting one never
    // gave. A reader must not leave this dialog believing they have agreed to
    // anything on a patient's behalf.
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('offers ambient capture, and says it sends nothing on its own', () => {
    renderDialog()

    const ambient = screen.getByRole('button', { name: /ambient/i }) as HTMLButtonElement
    expect(ambient.disabled).toBe(false)

    // The sentence that has to stay true whatever else changes here: choosing
    // a mode is not choosing to send this patient's audio.
    const claim = screen.getByText(/each patient is asked on the Record tab first/i)
    expect(claim.textContent).toMatch(/never remembered/i)
    expect(claim.textContent).toMatch(/Soniox/)
  })

  it('scopes the engine choice to press-to-record, which is the only path it governs', () => {
    renderDialog()

    // Ambient always uses the streaming provider, so an engine picker that
    // silently did nothing there would be a claim the app does not honour.
    expect(screen.getByText(/applies to press to record/i)).toBeTruthy()
  })

  it('claims no label review, which was removed with the review gate', () => {
    renderDialog()

    // The tip promised labels "you review line by line before anything enters
    // the transcript" for three days after #233 deleted that step.
    expect(screen.queryByText(/review line by line/i)).toBeNull()
  })
})
