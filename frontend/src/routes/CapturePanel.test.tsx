import type { DraftTurn, TextRange } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
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

vi.mock('../audio/live/AmbientCapture.js', () => {
  return { AmbientCapture: MockAmbientCapture }
})

/*
 * The ambient panel, mocked like `AudioCapture` above: this file is about what
 * the route does with a delivered transcript, and the streaming itself is
 * covered by `audio/live/AmbientCapture.test.tsx`.
 */
function MockAmbientCapture({
  onTranscript,
  onSwitchToManual,
  onLiveChange,
}: {
  onTranscript: (result: {
    text: string
    segments: {
      text: string
      start: number
      end: number | null
      uncertain?: readonly TextRange[]
    }[]
    source: 'asr_live'
    draftTurns?: readonly DraftTurn[]
  }) => void
  onSwitchToManual: () => void
  onLiveChange: (live: boolean) => void
}) {
  return (
    <>
      <button type="button" onClick={() => onLiveChange(true)}>
        mock go live
      </button>
      <button
        type="button"
        onClick={() => {
          onLiveChange(false)
          onTranscript({
            text: 'Any fever? Yesterday quite hot.',
            segments: [
              { text: 'Any fever?', start: 0, end: 2 },
              { text: 'Yesterday quite hot.', start: 2, end: 5 },
            ],
            source: 'asr_live',
            draftTurns: [
              { speaker: 'doctor', text: 'Any fever?' },
              { speaker: 'patient', text: 'Yesterday quite hot.' },
            ],
          })
        }}
      >
        mock transcribe live
      </button>
      {/* An ambient capture where the recogniser doubted one word (#309). The
          segment text is already whitespace-normalised, as everything
          `tokensToSegments` emits is, because the ranges describe that
          exact string. */}
      <button
        type="button"
        onClick={() => {
          onLiveChange(false)
          onTranscript({
            text: 'Saya teman dua hari Demam tu tinggi tak?',
            segments: [
              { text: 'Saya teman dua hari', start: 0, end: 2, uncertain: [{ start: 5, end: 10 }] },
              { text: 'Demam tu tinggi tak?', start: 2, end: 5 },
            ],
            source: 'asr_live',
            draftTurns: [
              { speaker: 'patient', text: 'Saya teman dua hari' },
              { speaker: 'doctor', text: 'Demam tu tinggi tak?' },
            ],
          })
        }}
      >
        mock transcribe uncertain
      </button>
      <button type="button" onClick={onSwitchToManual}>
        mock switch to manual
      </button>
    </>
  )
}

// A function declaration so the hoisted vi.mock factory above can reach it.
function MockAudioCapture({
  onTranscript,
  onBusyChange,
}: {
  onTranscript: (result: {
    text: string
    segments: { text: string; start: number; end: number | null }[]
    source: 'asr_local' | 'asr_hosted'
    draftTurns?: readonly DraftTurn[]
  }) => void
  onBusyChange: (busy: boolean) => void
}) {
  return (
    <>
      <button type="button" onClick={() => onBusyChange(true)}>
        mock manual busy
      </button>
      <button type="button" onClick={() => onBusyChange(false)}>
        mock manual idle
      </button>
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

function consultationCaptureProps(captureMode: 'ambient' | 'manual' = 'manual') {
  return {
    captureMode,
    onCaptureModeChange: vi.fn(),
    onCaptureBusyChange: vi.fn(),
  }
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CapturePanel
          {...consultationCaptureProps()}
          onCapture={vi.fn()}
          saving={false}
          error={null}
        />
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
    expect(textarea.value).toBe(
      'Doctor [0:00-0:02]: Any fever?\nPatient [0:02-0:05]: Yesterday quite hot.',
    )
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
      'Doctor [0:00-0:02]: Any fever?\nPatient [0:02-0:05]: Yesterday quite hot.\n' +
        'Doctor: Any fever?\nPatient: Yesterday quite hot.',
    )
  })

  it('appends a recording that follows one with skipped segments', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel
            {...consultationCaptureProps()}
            onCapture={vi.fn()}
            saving={false}
            error={null}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe sparse' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe' }))

    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe(
      'Doctor [0:00-0:02]: Any fever?\nPatient [0:03-0:05]: Yesterday quite hot.\n' +
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
          <CapturePanel
            {...consultationCaptureProps()}
            onCapture={vi.fn()}
            saving={false}
            error={null}
          />
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

  function open(captureMode: 'ambient' | 'manual' = 'manual') {
    function Harness() {
      const [mode, setMode] = useState(captureMode)
      return (
        <CapturePanel
          captureMode={mode}
          onCaptureModeChange={setMode}
          onCaptureBusyChange={vi.fn()}
          onCapture={captured}
          saving={false}
          error={null}
        />
      )
    }

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
  }

  /** The same, on a consultation whose stored mode is ambient. */
  function openAmbient() {
    open('ambient')
  }

  beforeEach(() => {
    // Cleared, not just re-stubbed: these read the most recent call, and a
    // previous test's submission would otherwise answer for this one.
    captured.mockClear()
    localStorage.clear()
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

  it('reports asr_live for an ambient consultation', async () => {
    openAmbient()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe live' }))

    const transcript = await submit()
    expect(transcript.source).toBe('asr_live')
    // Server-drafted labels, applied unreviewed, exactly as on the hosted path.
    expect(transcript.labelsReviewed).toBe(false)
  })

  it('stays asr_live when a later pass is on-device or relayed', async () => {
    // The widest egress wins and never comes back down. Ambient audio left the
    // device continuously and reached a provider the API never saw it pass
    // through, which is the broader claim of the two.
    openAmbient()
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe live' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock switch to manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe hosted' }))

    expect((await submit()).source).toBe('asr_live')
  })
})

/**
 * The Record tab always leads somewhere. The stored capture mode picks which
 * panel it shows, never whether it shows one, and switching modes strands
 * nobody on a dead panel.
 */
function renderRoute(captureMode: 'ambient' | 'manual' = 'manual') {
  const onCaptureModeChange = vi.fn()
  const onCaptureBusyChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CapturePanel
          captureMode={captureMode}
          onCaptureModeChange={onCaptureModeChange}
          onCaptureBusyChange={onCaptureBusyChange}
          onCapture={vi.fn()}
          saving={false}
          error={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onCaptureModeChange, onCaptureBusyChange }
}

/*
 * Ambient mode used to block the Record tab and tell the doctor the room was
 * already being listened to, while nothing listened. That removed the only
 * working capture and offered nothing in its place, so anyone who flipped the
 * toggle had bricked the flow (#254, hazard filed in #246).
 *
 * It captures now (#268), which changes what has to be asserted but not why.
 * The rule is that the Record tab always leads somewhere: a stored mode picks
 * which panel appears, and never whether one does.
 */
describe('ambient capture mode', () => {
  beforeEach(() => localStorage.clear())

  it('leaves Record usable in the default press-to-record mode', async () => {
    renderRoute()

    const record = await screen.findByRole('tab', { name: /record/i })
    expect(record.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('leaves Record usable when the consultation uses ambient mode', async () => {
    renderRoute('ambient')

    const record = await screen.findByRole('tab', { name: /record/i })
    expect(record.getAttribute('aria-disabled')).not.toBe('true')

    fireEvent.click(record)
    expect(record.getAttribute('aria-selected')).toBe('true')
    // A working panel, not a dead tab.
    expect(screen.getByRole('button', { name: 'mock transcribe live' })).toBeTruthy()
  })

  it('shows the consultation-owned ambient mode, and the manual panel otherwise', async () => {
    renderRoute('ambient')

    fireEvent.click(await screen.findByRole('tab', { name: /record/i }))
    expect(screen.getByRole('button', { name: 'mock transcribe live' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'mock transcribe' })).toBeNull()

    cleanup()
    renderRoute('manual')

    fireEvent.click(await screen.findByRole('tab', { name: /record/i }))
    expect(screen.getByRole('button', { name: 'mock transcribe' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'mock transcribe live' })).toBeNull()
  })

  it('stays mounted when the settings are saved to manual mid-session', async () => {
    // Stop is the only path that delivers the transcript, so unmounting the
    // panel from under a live socket would lose the consultation. The latch is
    // what stops a settings save doing that.
    const { onCaptureModeChange } = renderRoute('ambient')

    fireEvent.click(await screen.findByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock go live' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock switch to manual' }))

    expect(screen.getByRole('button', { name: 'mock transcribe live' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'mock transcribe' })).toBeNull()
    expect(onCaptureModeChange).toHaveBeenCalledWith('manual')
  })

  it('requests a persisted switch back to press-to-record', async () => {
    const { onCaptureModeChange } = renderRoute('ambient')

    fireEvent.click(await screen.findByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock switch to manual' }))

    expect(onCaptureModeChange).toHaveBeenCalledWith('manual')
  })

  it('claims no listening it is not doing', async () => {
    renderRoute('ambient')

    await screen.findByRole('tab', { name: /record/i })
    expect(screen.queryByText(/already being listened to/i)).toBeNull()
    expect(screen.queryByText(/ambient mode is on/i)).toBeNull()
  })

  it('offers the audio dialog from the capture screen', async () => {
    renderRoute()

    expect(await screen.findByRole('button', { name: /audio settings/i })).toBeTruthy()
  })

  it('reports manual and ambient capture ownership to the consultation', () => {
    const manual = renderRoute('manual')
    fireEvent.click(screen.getByRole('button', { name: 'mock manual busy' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock manual idle' }))
    expect(manual.onCaptureBusyChange.mock.calls).toEqual([[true], [false]])

    cleanup()
    const ambient = renderRoute('ambient')
    fireEvent.click(screen.getByRole('button', { name: 'mock go live' }))
    expect(ambient.onCaptureBusyChange).toHaveBeenCalledWith(true)
  })
})

describe('CapturePanel submit flow', () => {
  const captured = vi.fn()

  function renderForSubmit() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel
            {...consultationCaptureProps()}
            onCapture={captured}
            saving={false}
            error={null}
          />
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

describe('uncertain spans across the textarea', () => {
  const captured = vi.fn()

  function openAmbient() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <CapturePanel
            captureMode="ambient"
            onCaptureModeChange={vi.fn()}
            onCaptureBusyChange={vi.fn()}
            onCapture={captured}
            saving={false}
            error={null}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /record/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock transcribe uncertain' }))
  }

  const lastCapture = () => {
    const call = captured.mock.calls.at(-1)
    if (!call) throw new Error('expected a transcript to have been captured')
    return call[0] as { turns: { text: string; uncertain?: { start: number; end: number }[] }[] }
  }

  beforeEach(() => captured.mockClear())

  it('carries the doubted word through the round trip, still pointing at it', () => {
    openAmbient()
    const turn = lastCapture().turns[0]
    expect(turn?.text).toBe('Saya teman dua hari')
    // Sliced rather than compared as numbers: the whole risk here is an offset
    // that survives while meaning something else.
    const range = turn?.uncertain?.[0]
    expect(turn?.text.slice(range?.start ?? 0, range?.end ?? 0)).toBe('teman')
  })

  it('leaves an untouched neighbouring turn unmarked', () => {
    openAmbient()
    expect(lastCapture().turns[1]?.uncertain).toBeUndefined()
  })

  it('drops the ranges from a line the doctor edited', () => {
    // Once the words are the doctor's, a machine's doubt about the words it
    // replaced is no longer about anything on screen.
    openAmbient()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: { value: textarea.value.replace('Saya teman dua hari', 'Saya demam dua hari') },
    })
    fireEvent.click(screen.getByRole('button', { name: /use this transcript/i }))

    const turns = lastCapture().turns
    expect(turns[0]?.text).toBe('Saya demam dua hari')
    expect(turns[0]?.uncertain).toBeUndefined()
  })

  it('keeps the ranges when the doctor edits a different line', () => {
    openAmbient()
    fireEvent.click(screen.getByRole('tab', { name: /paste/i }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, {
      target: { value: textarea.value.replace('Demam tu tinggi tak?', 'Demam tinggi tak?') },
    })
    fireEvent.click(screen.getByRole('button', { name: /use this transcript/i }))

    const turns = lastCapture().turns
    expect(turns[0]?.uncertain).toEqual([{ start: 5, end: 10 }])
    expect(turns[1]?.uncertain).toBeUndefined()
  })
})
