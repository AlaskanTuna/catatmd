/**
 * How a position in the consultation's audio is written, everywhere it is
 * written.
 *
 * One implementation, because these are read side by side: the checklist row
 * naming a source at 0:04 and the transcript turn a doctor plays back from 0:04
 * have to agree, and two formatters drift the first time either is touched.
 *
 * Floors rather than rounds, so a stamp never names a moment the audio has not
 * reached yet.
 */
export const timestamp = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/**
 * The same instant for a screen reader, which reads `0:04` as "zero four".
 *
 * Used in the label of a control that plays one turn back, where the time is
 * the only thing distinguishing it from every other turn's control.
 */
export const spokenTimestamp = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  const spokenMinutes = minutes === 1 ? '1 minute' : `${minutes} minutes`
  const spokenSeconds = rest === 1 ? '1 second' : `${rest} seconds`
  return minutes === 0 ? spokenSeconds : `${spokenMinutes} ${spokenSeconds}`
}
