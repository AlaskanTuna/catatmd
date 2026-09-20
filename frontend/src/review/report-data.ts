import type {
  ConsultationDetail,
  Disposition,
  Prescription,
  RedFlag,
  SoapNote,
} from '@shared/types'
import { NOT_ESTABLISHED } from '@shared/types'
import { medicalRecordSections } from '../lib/note-templates.js'
import { SEVERITY_ORDER } from './live-prompt.js'
import { FOOD_LABELS, titleCase } from './prescription-draft.js'

export interface ReportSection {
  key: string
  label: string
  value: string
}

const SOAP_SECTIONS: ReadonlyArray<readonly [keyof SoapNote, string]> = [
  ['subjective', 'Subjective'],
  ['objective', 'Objective'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
]

const displayValue = (value: string) => (value.trim().length === 0 ? NOT_ESTABLISHED : value)

export function reportSections(detail: ConsultationDetail): ReportSection[] {
  const analysis = detail.analysis
  if (analysis === null) return []

  const medicalRecordNote = detail.editedMedicalRecordNote ?? analysis.medicalRecordNote ?? null
  const soapNote = detail.editedNote ?? analysis.note

  if (detail.noteTemplate === 'malaysian') {
    return medicalRecordSections(medicalRecordNote, soapNote)
  }

  /*
   * Unlike `formatNoteForClipboard`, which emits `subjective` raw, every
   * section takes the empty-value fallback here: on a printed page an empty
   * section reads as lost content, not as a field never established.
   */
  return SOAP_SECTIONS.map(([key, label]) => ({
    key,
    label,
    value: displayValue(soapNote[key]),
  }))
}

export interface PrescriptionRow {
  position: number
  drug: string
  dose: string
  directions: string
  duration: string
}

export function prescriptionRows(prescriptions: readonly Prescription[]): PrescriptionRow[] {
  return prescriptions.map((prescription, index) => {
    const parts = [
      prescription.route === null ? null : titleCase(prescription.route),
      prescription.frequency === null ? null : titleCase(prescription.frequency),
      prescription.food === null ? null : FOOD_LABELS[prescription.food],
    ].filter((part): part is string => part !== null)

    return {
      position: index + 1,
      drug: prescription.drug,
      dose: prescription.dose ?? '',
      directions: parts.length === 0 ? 'As directed' : parts.join(' · '),
      duration: prescription.duration ?? '',
    }
  })
}

export interface FlagEntry {
  flag: RedFlag
  disposition: string
}

const decidedAtFormat = new Intl.DateTimeFormat('en-MY', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dispositionText = (
  flag: RedFlag,
  dispositions: ReadonlyMap<string, Disposition>,
  acknowledgedIds: ReadonlySet<string>,
): string => {
  const disposition = dispositions.get(flag.id)
  if (disposition !== undefined) {
    switch (disposition.state) {
      case 'acknowledged':
        return `Acknowledged · ${decidedAtFormat.format(disposition.decidedAt)}`
      /*
       * `reason` is required on a dismissal by `DispositionSchema`'s refine but
       * optional on the inferred type, so the fallback drops the separator
       * rather than printing a dangling one.
       */
      case 'dismissed':
        return disposition.reason === undefined ? 'Dismissed' : `Dismissed · ${disposition.reason}`
      case 'not_applicable':
        return `Not applicable · ${decidedAtFormat.format(disposition.decidedAt)}`
    }
  }
  /*
   * Consultations reviewed before dispositions shipped carry only the boolean
   * list; an id there meant acknowledged, and printing `Not reviewed` would
   * misreport a review that happened.
   */
  if (acknowledgedIds.has(flag.id)) return 'Acknowledged'
  return 'Not reviewed'
}

export function flagEntries(detail: ConsultationDetail): FlagEntry[] {
  const analysis = detail.analysis
  if (analysis === null) return []

  const dispositions = new Map(detail.redFlagDispositions.map((entry) => [entry.id, entry]))
  const acknowledgedIds = new Set(detail.acknowledgedRedFlagIds)

  return [...analysis.redFlags]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((flag) => ({ flag, disposition: dispositionText(flag, dispositions, acknowledgedIds) }))
}
