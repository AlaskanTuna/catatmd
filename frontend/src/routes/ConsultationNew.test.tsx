import type { DraftTurn } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api.js'
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
    source: 'asr_local' | 'asr_hosted'
    draftTurns?: readonly DraftTurn[]
  }) => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: ' Any fever? Yesterday quite hot.',
            segments: [
              { text: ' Any fever?', start: 0, end: 2 },
              { text: ' Yesterday quite hot.', start: 2, end: 5 },
            ],
            source: 'asr_local',
          })
        }
      >
        mock transcribe
      </button>
      {/* The same recording, but taken via the hosted relay, so the route's
          provenance stickiness can be driven in either order. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: ' Any fever? Yesterday quite hot.',
            segments: [
              { text: ' Any fever?', start: 0, end: 2 },
              { text: ' Yesterday quite hot.', start: 2, end: 5 },
            ],
            source: 'asr_hosted',
          })
        }
      >
        mock transcribe hosted
      </button>
      {/* An empty middle segment is skipped by segmentsToDraft, leaving a
          draft whose seg-N ids run past its line count. That is the shape
          under which appended lines re-idd as seg-<length + i> collide. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: ' Any fever? Yesterday quite hot.',
            segments: [
              { text: ' Any fever?', start: 0, end: 2 },
              { text: '   ', start: 2, end: 3 },
              { text: ' Yesterday quite hot.', start: 3, end: 5 },
            ],
            source: 'asr_local',
          })
        }
      >
        mock transcribe sparse
      </button>
      {/* The hosted path once the server has drafted turns (#189): no
          segments and no offsets, since the hosted relay carries no timing. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: 'Any fever? Yesterday quite hot.',
            segments: [],
            source: 'asr_hosted',
            draftTurns: [
              { speaker: 'doctor', text: 'Any fever?' },
              { speaker: 'patient', text: 'Yesterday quite hot.' },
            ],
          })
        }
      >
        mock transcribe hosted labelled
      </button>
      {/* Hosted with no drafted turns and no usable segments: labelling
          failed server-side, so the caller falls back to raw prose. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: 'Batuk sudah tiga hari.',
            segments: [],
            source: 'asr_hosted',
          })
        }
      >
        mock transcribe hosted raw
      </button>
      {/* A hosted draft carrying a measured Malay mishear (docs/trd.md
          §20.3), so the tap-to-correct chip can be driven end to end. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: 'Patut sudah empat hari.',
            segments: [],
            source: 'asr_hosted',
            draftTurns: [{ speaker: 'patient', text: 'Patut sudah empat hari.' }],
          })
        }
      >
        mock transcribe hosted misheard
      </button>
    </>
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

  it('flips exactly one line when a recording is appended after skipped segments', () => {
    // With the old seg-<length + i> re-idding, the sparse draft's seg-2 and
    // the appended recording's first line share an id, and one tap flips both.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ConsultationNew />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe sparse' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    const doctorToggles = screen.getAllByRole('button', { name: 'Doctor, switch to Patient' })
    expect(doctorToggles).toHaveLength(2)
    fireEvent.click(doctorToggles[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00]: Any fever?\nPatient [0:03]: Yesterday quite hot.\n' +
        'Patient: Any fever?\nPatient: Yesterday quite hot.',
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

/**
 * The hosted-draft-labelling pass (#189): server-drafted turns feed the same
 * review surface as the on-device draft, carry no offsets, and a labelling
 * failure falls back to the unlabelled prose the record path always had.
 */
describe('hosted draft-turn labelling', () => {
  function openRecordTab() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ConsultationNew />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  }

  it('renders the server-drafted turns in SpeakerAssign and keeps Start disabled', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted labelled' }))

    expect(screen.getByText('Any fever?')).toBeTruthy()
    expect(screen.getByText('Yesterday quite hot.')).toBeTruthy()
    const start = screen.getByRole('button', { name: /start consultation/i }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
  })

  it('applies drafted hosted turns as lines with no timestamps', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted labelled' }))
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Doctor: Any fever?\nPatient: Yesterday quite hot.')
  })

  it('falls back to raw prose when a hosted result carries no drafted turns', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted raw' }))

    // No draft pending: the text landed straight in the textarea rather than
    // behind SpeakerAssign, unlike the drafted-turns path above.
    expect(screen.queryByRole('button', { name: /apply labels/i })).toBeNull()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Batuk sudah tiga hari.')
  })

  it('corrects a measured mishear on tap and applies the corrected line', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted misheard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace Patut with Batuk' }))

    // The correction consumes its own hint: the chip disappears with it.
    expect(screen.queryByRole('button', { name: 'Replace Patut with Batuk' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Patient: Batuk sudah empat hari.')
  })

  it('re-ids a second delivery appended to a pending hosted draft without colliding', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted labelled' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    const doctorToggles = screen.getAllByRole('button', { name: 'Doctor, switch to Patient' })
    expect(doctorToggles).toHaveLength(2)
    // Flips only the appended recording's doctor line, leaving the hosted
    // draft's own doctor line untouched: proof the two id namespaces
    // (`hosted-N` and `append-N-i`) do not collide.
    fireEvent.click(doctorToggles[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor: Any fever?\nPatient: Yesterday quite hot.\n' +
        'Patient: Any fever?\nPatient: Yesterday quite hot.',
    )
  })
})

/**
 * What the submitted transcript claims about where its audio has been
 * (issue #155).
 *
 * Client-asserted and unverifiable by the API, which is why no safety control
 * rests on it. It is still what an auditor reads to answer "did this
 * consultation's audio leave the device", so understating it is the one
 * direction that must be impossible.
 */
describe('recording provenance', () => {
  /**
   * The transcript the route actually submits. Awaited, because `mutate()`
   * runs the mutation in a microtask rather than on the click.
   */
  async function submit() {
    fireEvent.click(screen.getByRole('button', { name: /apply labels/i }))
    fireEvent.click(screen.getByRole('button', { name: /start consultation/i }))
    await waitFor(() => expect(api.createConsultation).toHaveBeenCalled())
    const call = vi.mocked(api.createConsultation).mock.calls.at(-1)
    if (!call) throw new Error('expected a consultation to have been created')
    return call[0]
  }

  function open() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ConsultationNew />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  }

  beforeEach(() => {
    // Cleared, not just re-stubbed: these read the most recent call, and a
    // previous test's submission would otherwise answer for this one.
    vi.mocked(api.createConsultation).mockClear()
    vi.mocked(api.createConsultation).mockResolvedValue({
      id: 'c1',
    } as Awaited<ReturnType<typeof api.createConsultation>>)
  })

  it('reports asr_local for an on-device recording', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    expect((await submit()).source).toBe('asr_local')
  })

  it('reports asr_hosted for a relayed recording', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted' }))

    expect((await submit()).source).toBe('asr_hosted')
  })

  it('stays asr_hosted when a later pass is on-device', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    // Downgrading here would let a transcript whose audio reached ILMU submit
    // as though it never left the device.
    expect((await submit()).source).toBe('asr_hosted')
  })

  it('becomes asr_hosted when a later pass is relayed', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted' }))

    expect((await submit()).source).toBe('asr_hosted')
  })
})
