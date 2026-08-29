/** SOAP note sections used for per-field clinic CMS paste (Task #12). */
export type SoapNoteInput = {
  readonly subjective: string
  readonly objective: string
  readonly assessment: string
  readonly plan: string
}

type DocumentedAssertion = {
  readonly state: string
  readonly value?: string
}

/** Operational block fields assembled into a one-line summary. */
export type OperationalBlockInput = {
  readonly diagnosis: DocumentedAssertion
  readonly medicationsDispensed: readonly DocumentedAssertion[]
  readonly mcDays: DocumentedAssertion
  readonly referral: DocumentedAssertion
  readonly followUp: DocumentedAssertion
}
export const SOAP_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const

export type SoapSection = (typeof SOAP_SECTIONS)[number]

export const SOAP_SECTION_LABELS: Readonly<Record<SoapSection, string>> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
}

/** Returns the section body only — no heading — for pasting into a CMS field. */
export function formatSoapSectionForClipboard(section: SoapSection, note: SoapNoteInput): string {
  return note[section]
}

/** Full SOAP note with headings, for a single-field paste or print preview. */
export function formatSoapNoteForClipboard(note: SoapNoteInput): string {
  return SOAP_SECTIONS.map((section) => `${SOAP_SECTION_LABELS[section]}\n${note[section]}`).join(
    '\n\n',
  )
}

function documentedValue(assertion: DocumentedAssertion): string | undefined {
  if (assertion.state !== 'PRESENT' && assertion.state !== 'CLINICIAN_OBSERVED') return undefined
  const value = assertion.value?.trim()
  return value ? value : undefined
}

/**
 * One-line encounter summary from documented operational fields only.
 *
 * Assembles doctor-stated diagnosis, dispensed medications, MC days, referral,
 * and follow-up — the payer-facing fields a Malaysian GP pastes into CMS slots.
 * Does not infer or generate clinical content.
 */
export function formatEncounterSummary(operational: OperationalBlockInput): string {
  const parts: string[] = []

  const diagnosis = documentedValue(operational.diagnosis)
  if (diagnosis) parts.push(diagnosis)

  for (const medication of operational.medicationsDispensed) {
    const value = documentedValue(medication)
    if (value) parts.push(value)
  }

  const mcDays = documentedValue(operational.mcDays)
  if (mcDays) parts.push(mcDays)

  const referral = documentedValue(operational.referral)
  if (referral) parts.push(referral)

  const followUp = documentedValue(operational.followUp)
  if (followUp) parts.push(followUp)

  return parts.join(', ')
}
