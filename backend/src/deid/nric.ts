/**
 * Structural validation for the Malaysian NRIC (MyKad), `YYMMDD-PB-###G`.
 *
 * MyKad has **no checksum**, so shape plus a valid birth date plus a valid
 * place-of-birth code is the only structural check that exists. It cuts false
 * positives at zero recall cost — anything shaped like an NRIC is still
 * inspected; this only decides how much confidence the match carries.
 *
 * The place-of-birth table is copied from the MIT-licensed `mykad` package
 * rather than taken as a dependency (docs/trd.md §9).
 */

/** Codes never issued. Everything else in 01–93 is a real state or country. */
const UNASSIGNED_PB = new Set([
  '00',
  '17',
  '18',
  '19',
  '20',
  '69',
  '70',
  '73',
  '80',
  '81',
  '94',
  '95',
  '96',
  '97',
  '98',
  '99',
])

export const NRIC_PATTERN = /\b(\d{6})-(\d{2})-(\d{4})\b/g

function isValidBirthDate(yymmdd: string): boolean {
  const month = Number(yymmdd.slice(2, 4))
  const day = Number(yymmdd.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false

  // Century is ambiguous in a 6-digit date, so accept the day if it is valid in
  // either century rather than guessing one.
  const year = Number(yymmdd.slice(0, 2))
  return [1900 + year, 2000 + year].some(
    (full) => new Date(full, month - 1, day).getMonth() === month - 1,
  )
}

export function isStructurallyValidNric(candidate: string): boolean {
  const match = /^(\d{6})-(\d{2})-(\d{4})$/.exec(candidate)
  if (!match) return false

  const [, yymmdd, pb] = match
  if (!yymmdd || !pb) return false
  return isValidBirthDate(yymmdd) && !UNASSIGNED_PB.has(pb)
}
