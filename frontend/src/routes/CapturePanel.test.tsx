import type { DraftTurn } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapturePanel } from './CapturePanel.js'

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
      {/* A hosted draft where one chunk came back unlabelled, so the server
          marked it rather than inventing a speaker for it. */}
      <button
        type="button"
        onClick={() =>
          onTranscript({
            text: 'What brings you in? batuk sudah tiga hari',
            segments: [],
            source: 'asr_hosted',
            draftTurns: [
              { speaker: 'doctor', text: 'What brings you in?' },
              { speaker: 'doctor', text: 'batuk sudah tiga hari', undrafted: true },
            ],
          })
        }
      >
        mock transcribe hosted partial
      </button>
    </>
  )
}

afterEach(cleanup)

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CapturePanel onCapture={vi.fn()} saving={false} error={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
}

describe('CapturePanel record flow', () => {
  /*
   * Drafted labels land in the transcript on delivery. The review step they
   * used to wait behind is gone: the workflow it belonged to is being replaced
   * by one where the note and the safety panels fill while the doctor is still
   * talking, and there is no moment in that to tweak a label.
   *
   * What the step was protecting is now `labelsReviewed`, pinned in the
   * provenance block below and enforced in
   * `backend/src/redflags/mislabel-suppression.test.ts`, which is where the
   * guarantee is actually testable.
   */
  it('applies drafted labels straight into the transcript, with timestamps', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Doctor [0:00]: Any fever?\nPatient [0:02]: Yesterday quite hot.')
  })

  it('enables Use This Transcript as soon as a recording lands', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const start = screen.getByRole('button', { name: /use this transcript/i })
    expect((start as HTMLButtonElement).disabled).toBe(false)
  })

  /*
   * A later recording's timebase restarts at zero, so its lines must carry
   * labels but no timestamps; a wrong 0:04 in the evidence trace is worse than
   * none. This survived the removal of the review step unchanged, and is the
   * reason the append path still has to be tested at all.
   */
  it('drops timestamps on a second recording', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00]: Any fever?\nPatient [0:02]: Yesterday quite hot.\n' +
        'Doctor: Any fever?\nPatient: Yesterday quite hot.',
    )
  })

  it('appends a recording that follows one with skipped segments', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel onCapture={vi.fn()} saving={false} error={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe sparse' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00]: Any fever?\nPatient [0:03]: Yesterday quite hot.\n' +
        'Doctor: Any fever?\nPatient: Yesterday quite hot.',
    )
  })
})

/**
 * The hosted labelling pass (#189): server-drafted turns carry no offsets, and
 * a labelling failure falls back to the unlabelled prose the record path always
 * had. Both now apply on delivery rather than through a review surface.
 */
describe('hosted draft-turn labelling', () => {
  function openRecordTab() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel onCapture={vi.fn()} saving={false} error={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  }

  const pasted = () => {
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    return (screen.getByRole('textbox') as HTMLTextAreaElement).value
  }

  it('applies drafted hosted turns as lines with no timestamps', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted labelled' }))

    expect(pasted()).toBe('Doctor: Any fever?\nPatient: Yesterday quite hot.')
  })

  it('keeps a hosted recording usable when no drafted turns come back', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted' }))

    // The prose fallback: labelling failed, the recording is not lost, and the
    // doctor can still submit it.
    expect(pasted()).toMatch(/Any fever/)
    const start = screen.getByRole('button', { name: /use this transcript/i }) as HTMLButtonElement
    expect(start.disabled).toBe(false)
  })

  it('lands a span the server could not label, without leaking the marker', () => {
    openRecordTab()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted partial' }))

    // `undrafted` was a signal to the review list, which no longer exists. The
    // text still has to reach the transcript, and the flag itself must not.
    const value = pasted()
    expect(value).toMatch(/batuk sudah tiga hari/)
    expect(value).not.toMatch(/undrafted/)
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
  /*
   * Reads the capture callback rather than the create request. The panel no
   * longer creates the consultation — the record exists before capture begins
   * — but the property these pin is unchanged: a transcript whose audio
   * reached a hosted relay must never report as having stayed on the device.
   */
  const captured = vi.fn()

  async function submit() {
    const button = screen.queryByRole('button', { name: /use this transcript/i })
    if (button) fireEvent.click(button)
    await waitFor(() => expect(captured).toHaveBeenCalled())
    const call = captured.mock.calls.at(-1)
    if (!call) throw new Error('expected a transcript to have been captured')
    return call[0] as { source: string; labelsReviewed?: boolean }
  }

  function open() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel onCapture={captured} saving={false} error={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  }

  beforeEach(() => {
    // Cleared, not just re-stubbed: these read the most recent call, and a
    // previous test's submission would otherwise answer for this one.
    captured.mockClear()
  })

  /*
   * `labelsReviewed` decides whether the red-flag engine may drop a trigger hit
   * on a question-denial reading (shared/src/index.ts). Understating it costs a
   * flag the doctor dismisses; overstating it can cost a flag nobody ever sees,
   * so the recorded paths are pinned explicitly rather than left to a default.
   */
  it("never claims a recording's labels were reviewed", async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    expect((await submit()).labelsReviewed).toBe(false)
  })

  it("never claims a hosted recording's labels were reviewed", async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted labelled' }))

    expect((await submit()).labelsReviewed).toBe(false)
  })

  it('reports labels as reviewed when the doctor typed them', async () => {
    open()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Doctor: Any fever?\nPatient: Since yesterday.' },
    })

    const transcript = await submit()
    expect(transcript.source).toBe('paste')
    expect(transcript.labelsReviewed).toBe(true)
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

/**
 * Ambient mode and the Record tab are mutually exclusive by design: ambient
 * already listens to the room for the whole session, so pressing record would
 * start a second capture of the same consultation.
 *
 * The properties worth pinning are the ones a doctor would experience as a bug
 * if they broke — the tab is visibly blocked rather than missing, the reason is
 * on screen, and switching modes never strands anyone on a dead panel.
 */
function renderRoute() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CapturePanel onCapture={vi.fn()} saving={false} error={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ambient capture mode', () => {
  beforeEach(() => localStorage.clear())

  it('leaves Record usable in the default press-to-record mode', async () => {
    renderRoute()

    const record = await screen.findByRole('tab', { name: /record/i })
    expect(record.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('blocks Record when ambient mode is on, and says why', async () => {
    localStorage.setItem('catatmd.audio', JSON.stringify({ mode: 'ambient' }))
    renderRoute()

    const record = await screen.findByRole('tab', { name: /record/i })
    expect(record.getAttribute('aria-disabled')).toBe('true')
    expect(await screen.findByText(/ambient mode is on/i)).toBeTruthy()
  })

  it('does not open the Record panel when the blocked tab is clicked', async () => {
    localStorage.setItem('catatmd.audio', JSON.stringify({ mode: 'ambient' }))
    renderRoute()

    const record = await screen.findByRole('tab', { name: /record/i })
    fireEvent.click(record)

    // Selection never moves to the blocked tab, so the recorder never mounts.
    expect(record.getAttribute('aria-selected')).toBe('false')
    expect(await screen.findByText(/ambient mode is on/i)).toBeTruthy()
  })

  it('offers the audio dialog from the capture screen', async () => {
    renderRoute()

    expect(await screen.findByRole('button', { name: /audio settings/i })).toBeTruthy()
  })
})

describe('CapturePanel submit flow', () => {
  const captured = vi.fn()

  function renderForSubmit() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel onCapture={captured} saving={false} error={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  function makeTextFile(content: string, name = 'transcript.txt'): File {
    const file = new File([content], name, { type: 'text/plain' })
    if (typeof file.text !== 'function') {
      Object.defineProperty(file, 'text', {
        value: async () => content,
        configurable: true,
        writable: true,
      })
    }
    return file
  }

  function firstCapture<T>(): T {
    const call = captured.mock.calls.at(0)
    if (!call) throw new Error('expected a transcript to have been captured')
    return call[0] as T
  }

  beforeEach(() => {
    captured.mockClear()
  })

  it('submits an uploaded transcript on its own, with labelsReviewed false', async () => {
    renderForSubmit()
    fireEvent.click(screen.getByRole('tab', { name: /upload/i }))
    const file = makeTextFile('Doctor: Any fever?\nPatient: Since yesterday.')
    fireEvent.change(screen.getByLabelText(/Transcript File/i), { target: { files: [file] } })
    await waitFor(() => expect(captured).toHaveBeenCalled())
    const transcript = firstCapture<{ source: string; labelsReviewed?: boolean }>()
    expect(transcript.source).toBe('upload')
    expect(transcript.labelsReviewed).toBe(false)
  })

  it('submits the uploaded text, not the text already in the textarea', async () => {
    renderForSubmit()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Doctor: Old question?\nPatient: Old answer.' },
    })
    fireEvent.click(screen.getByRole('tab', { name: /upload/i }))
    const file = makeTextFile('Patient: New symptom.\nDoctor: Any fever?')
    fireEvent.change(screen.getByLabelText(/Transcript File/i), { target: { files: [file] } })
    await waitFor(() => expect(captured).toHaveBeenCalled())
    const transcript = firstCapture<{ turns: { speaker: string; text: string }[] }>()
    expect(transcript.turns).toEqual([
      { speaker: 'patient', text: 'New symptom.' },
      { speaker: 'doctor', text: 'Any fever?' },
    ])
  })

  it('submits a finished recording on its own, with no button press', async () => {
    renderForSubmit()
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))
    await waitFor(() => expect(captured).toHaveBeenCalled())
    const transcript = firstCapture<{ source: string; labelsReviewed?: boolean }>()
    expect(transcript.source).toBe('asr_local')
    expect(transcript.labelsReviewed).toBe(false)
  })

  it('shows Use This Transcript only on the Paste tab', () => {
    renderForSubmit()
    expect(screen.queryByRole('button', { name: /use this transcript/i })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /upload/i }))
    expect(screen.queryByRole('button', { name: /use this transcript/i })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    expect(screen.queryByRole('button', { name: /use this transcript/i })).toBeTruthy()
  })

  it('submits a pasted transcript on the button press, with labelsReviewed true', async () => {
    renderForSubmit()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Doctor: Any fever?\nPatient: Since yesterday.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /use this transcript/i }))
    await waitFor(() => expect(captured).toHaveBeenCalled())
    const transcript = firstCapture<{ source: string; labelsReviewed?: boolean }>()
    expect(transcript.source).toBe('paste')
    expect(transcript.labelsReviewed).toBe(true)
  })
})
