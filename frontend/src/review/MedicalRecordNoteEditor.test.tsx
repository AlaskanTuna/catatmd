import type { MedicalRecordNote, SoapNote } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LegacyMedicalRecordView, MedicalRecordNoteEditor } from './MedicalRecordNoteEditor.js'

const AI_NOTE: MedicalRecordNote = {
  presentingComplaint: 'Cough.',
  historyOfPresentingComplaint: 'Three days.',
  pastMedicalHistory: '',
  socialHistory: 'Does not smoke.',
  familyHistory: '',
  objective: 'Temperature 37.2°C.',
  assessment: 'Acute cough under review.',
  plan: 'Supportive care.',
}

afterEach(cleanup)

describe('MedicalRecordNoteEditor', () => {
  it('renders the Malaysian headings in record order and never omits an empty category', () => {
    render(
      <MedicalRecordNoteEditor
        note={AI_NOTE}
        aiNote={AI_NOTE}
        template="malaysian"
        readOnly
        saving={false}
        onSave={vi.fn()}
      />,
    )

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'Presenting Complaint',
      'History of Presenting Complaint',
      'Past Medical History',
      'Social History',
      'Family History',
      'Objective',
      'Assessment',
      'Plan',
    ])
    expect(screen.getAllByText('Not established')).toHaveLength(2)
    expect(screen.getAllByText('AI Generated')).toHaveLength(8)
  })

  it('edits one Malaysian category without replacing its neighbours', () => {
    const onSave = vi.fn()
    render(
      <MedicalRecordNoteEditor
        note={AI_NOTE}
        aiNote={AI_NOTE}
        template="malaysian"
        readOnly={false}
        saving={false}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit Family History' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Family History' }), {
      target: { value: 'Mother has asthma.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Family History' }))

    expect(onSave).toHaveBeenCalledWith({ familyHistory: 'Mother has asthma.' })
  })

  it('composes SOAP Subjective from the same five editable history fields', () => {
    render(
      <MedicalRecordNoteEditor
        note={{ ...AI_NOTE, familyHistory: 'Mother has asthma.' }}
        aiNote={AI_NOTE}
        template="soap"
        readOnly={false}
        saving={false}
        onSave={vi.fn()}
      />,
    )

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Subjective', 'Objective', 'Assessment', 'Plan'])
    expect(screen.getByText(/Family History\s+Mother has asthma\./)).toBeTruthy()
    expect(screen.getAllByText('You Edited This')).toHaveLength(1)
  })

  it('saves all five history fields when editing SOAP Subjective', () => {
    const onSave = vi.fn()
    render(
      <MedicalRecordNoteEditor
        note={AI_NOTE}
        aiNote={AI_NOTE}
        template="soap"
        readOnly={false}
        saving={false}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit Subjective' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Family History' }), {
      target: { value: 'Mother has asthma.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Subjective' }))

    expect(onSave).toHaveBeenCalledWith({
      presentingComplaint: 'Cough.',
      historyOfPresentingComplaint: 'Three days.',
      pastMedicalHistory: '',
      socialHistory: 'Does not smoke.',
      familyHistory: 'Mother has asthma.',
    })
  })

  it('keeps approved canonical notes read-only', () => {
    render(
      <MedicalRecordNoteEditor
        note={AI_NOTE}
        aiNote={AI_NOTE}
        template="malaysian"
        readOnly
        saving={false}
        onSave={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
  })
})

describe('LegacyMedicalRecordView', () => {
  it('makes unavailable history categories explicit for older analyses', () => {
    const note: SoapNote = {
      subjective: 'Cough for three days.',
      objective: 'Temperature 37.2°C.',
      assessment: 'Acute cough under review.',
      plan: 'Supportive care.',
    }

    render(<LegacyMedicalRecordView note={note} aiNote={note} />)

    expect(screen.getAllByText('Not recorded by this analysis version')).toHaveLength(5)
    expect(screen.getByText('Temperature 37.2°C.')).toBeTruthy()
  })
})
