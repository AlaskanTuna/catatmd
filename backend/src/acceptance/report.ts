/**
 * Collects the PRD §16 acceptance targets as measured numbers so the suite
 * reports evidence rather than a pass/fail tick.
 *
 * **These are engineering targets measured on synthetic fixtures. They are not
 * clinical validation and must never be reported as clinical performance.** No
 * clinician has reviewed the trigger list, the guideline corpus, or any fixture
 * (`docs/prd.md` §12). The distinction is stated here because this file is
 * where the numbers come from, and the numbers are what get quoted.
 */

export interface Measurement {
  readonly label: string
  readonly measured: number
  readonly target: number
  readonly denominator?: number
  readonly unit?: string
}

const measurements: Measurement[] = []

export function record(
  label: string,
  measured: number,
  target: number,
  extra: { denominator?: number; unit?: string } = {},
): void {
  measurements.push({ label, measured, target, ...extra })
}

export function formatReport(): string {
  if (measurements.length === 0) return ''

  const rows = measurements.map((m) => {
    const denominator = m.denominator ?? (m.target > 0 ? m.target : undefined)
    const value =
      denominator !== undefined && denominator > 0
        ? `${m.measured}/${denominator}`
        : String(m.measured)
    const met = m.denominator !== undefined ? m.measured === m.target : m.measured === m.target
    return `  ${met ? 'PASS' : 'FAIL'}  ${m.label}: ${value}${m.unit ? ` ${m.unit}` : ''}`
  })

  return [
    '',
    'Clinical-safety acceptance targets (PRD §16)',
    'Engineering targets on synthetic fixtures — NOT clinical validation.',
    ...rows,
    '',
  ].join('\n')
}
