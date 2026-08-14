import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsultationNew } from './ConsultationNew.js'

/*
 * The submit gate is a safety control, not UX polish: while drafted labels
 * are pending, the recording is not in the transcript and Start must stay
 * disabled, so unreviewed guessed labels can never reach the API (#118, and
 * issue #70 for why a mislabelled pair is dangerous). AudioCapture is mocked
 * to hand the route a canned worker result; everything downstream of that
 * callback is real.
 */

vi.mock('../lib/api.js', () => {
  return {
    ApiError: class extends Error {},
    api: {
      fixtures: vi.fn(() => new Promise(() => {})),
      createConsultation: vi.fn(),
    },
  }
})

vi.mock('../audio/AudioCapture.js', () => {
  return { AudioCapture: MockAudioCapture }
})

// A function declaration so the hoisted vi.mock factory above can reach it.
function MockAudioCapture({
  onTranscript,
}: {
  onTranscript: (result: {
    text: string
    segments: { text: string; start: number; end: number | null }[]
  }) => void
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onTranscript({
          text: ' Any fever? Yesterday quite hot.',
          segments: [
            { text: ' Any fever?', start: 0, end: 2 },
            { text: ' Yesterday quite hot.', start: 2, end: 5 },
          ],
        })
      }
    >
      mock transcribe
    </button>
  )
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ConsultationNew />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
}

describe('ConsultationNew record flow', () => {
  it('keeps Start disabled while a draft is pending, and enables it after Apply', () => {
    setup()
    const start = screen.getByRole('button', { name: /start consultation/i })
    expect((start as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    expect((start as HTMLButtonElement).disabled).toBe(false)
  })

  it('applies drafted labels as parseable lines with timestamps', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Doctor [0:00]: Any fever?\nPatient [0:02]: Yesterday quite hot.')
  })

  it('flips one line without touching the others', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Patient, switch to Doctor' }))
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Doctor [0:00]: Any fever?\nDoctor [0:02]: Yesterday quite hot.')
  })

  /*
   * A later recording's timebase restarts at zero, so its lines must carry
   * labels but no timestamps; a wrong 0:04 in the evidence trace is worse
   * than none. Both halves of the condition: transcript already applied, and
   * draft still pending.
   */
  it('drops timestamps on a recording made after the first was applied', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00]: Any fever?\nPatient [0:02]: Yesterday quite hot.\n' +
        'Doctor: Any fever?\nPatient: Yesterday quite hot.',
    )
  })

  it('drops timestamps on a recording appended to a still-pending draft', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00]: Any fever?\nPatient [0:02]: Yesterday quite hot.\n' +
        'Doctor: Any fever?\nPatient: Yesterday quite hot.',
    )
  })
})
