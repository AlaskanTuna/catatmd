import { recordAuditEvent } from '../audit/index.js'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'

/**
 * Storing and destroying the consultation recording (#293).
 *
 * The recording exists for one reason: a recogniser that invents a phrase
 * produces a sentence that reads exactly like a correct one, so the transcript
 * cannot be checked against itself. It is a working artefact for that check,
 * never the clinical record, which is the approved note.
 *
 * **Three properties this module is responsible for keeping true.**
 *
 * 1. Nothing is stored while `AUDIO_RETENTION_HOURS` is unset. The controller
 *    adopts a retention period; the code never substitutes one.
 * 2. Nothing is served past its expiry, whether or not a sweep has run. The
 *    read path checks the clock rather than trusting that deletion happened.
 * 3. Erasure destroys the row outright rather than tombstoning it. The clinical
 *    columns are nulled in place because `AuditEvent` chains on the
 *    consultation id; a recording has no such tie and no reason to persist as
 *    an emptied shell.
 *
 * Approval deliberately does **not** destroy it. That matches the published
 * behaviour of Abridge and Nuance DAX, which keep audio for a fixed window
 * regardless of when the note is signed, so a doctor can still check a sentence
 * on a note they have already approved. The window is what bounds it.
 */

/** The largest recording accepted, matching the hosted relay's own cap. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** Whether the controller has adopted a retention period at all. */
export function audioRetentionEnabled(): boolean {
  return env.AUDIO_RETENTION_HOURS !== undefined
}

/**
 * Stores a recording against a consultation, replacing any it already had.
 *
 * Replacing rather than refusing, because a doctor who re-records a
 * consultation means the second take: the transcript is rebuilt from it, so
 * keeping the first would leave offsets pointing into audio that no longer
 * corresponds to the words on screen.
 */
export async function storeAudio(
  consultationId: string,
  actorId: string,
  data: Uint8Array<ArrayBuffer>,
  mimeType: string,
): Promise<{ expiresAt: Date }> {
  const hours = env.AUDIO_RETENTION_HOURS
  if (hours === undefined) {
    throw new Error('storeAudio called with no retention period adopted')
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
  await prisma.consultationAudio.upsert({
    where: { consultationId },
    create: { consultationId, data, mimeType, expiresAt },
    update: { data, mimeType, expiresAt, createdAt: new Date() },
  })

  await recordAuditEvent({
    action: 'consultation.audio_stored',
    actorId,
    consultationId,
    metadata: { bytes: data.length, retentionHours: hours },
  })

  return { expiresAt }
}

/**
 * Reads a recording that has not expired.
 *
 * The expiry is enforced here rather than left to the sweep, so a recording is
 * never served past its window even if nothing has swept yet. A sweep that has
 * not run is a tidiness problem; serving expired audio would be a retention
 * one.
 */
export async function readAudio(
  consultationId: string,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  /*
   * The clock is in the WHERE clause, not in a comparison afterwards. Reading
   * the row first and discarding it would pull up to 25 MB out of Postgres for
   * a recording nobody may have, and the index on `expiresAt` exists precisely
   * so the expired case never touches the bytes.
   *
   * `findFirst` rather than `findUnique`, because a unique lookup cannot carry
   * a second condition.
   */
  const row = await prisma.consultationAudio.findFirst({
    where: { consultationId, expiresAt: { gt: new Date() } },
    select: { data: true, mimeType: true },
  })
  if (row === null) return null
  // Returned as-is. `res.send` accepts a Uint8Array, and `Buffer.from` here
  // would copy a buffer the driver has already materialised, doubling the peak.
  return { data: row.data, mimeType: row.mimeType }
}

/**
 * Destroys the recording for one consultation, if it has one.
 *
 * Called from the erasure path. Returns whether anything was there, so the
 * caller can skip an audit row for a consultation that never had audio rather
 * than writing one that says nothing happened.
 */
export async function purgeAudio(consultationId: string, actorId: string): Promise<boolean> {
  const { count } = await prisma.consultationAudio.deleteMany({ where: { consultationId } })
  if (count === 0) return false

  await recordAuditEvent({
    action: 'consultation.audio_purged',
    actorId,
    consultationId,
  })
  return true
}

/**
 * Deletes every recording whose window has closed.
 *
 * **This is the mechanism that makes the retention period a control rather than
 * a claim.** A stated window nothing enforces is worse than no claim at all, so
 * this runs rather than being left to a scheduler the project does not have:
 * it is invoked opportunistically from the upload route, which is the only
 * place a new recording can appear and therefore the only place the store can
 * grow. Cheap, because `expiresAt` is indexed and the ordinary result is zero
 * rows.
 *
 * No `actorId` and no `consultationId`: this is the system acting on a clock,
 * not a doctor acting on a record, and attributing it to whoever happened to
 * upload next would misread the trail.
 */
export async function sweepExpiredAudio(): Promise<number> {
  const { count } = await prisma.consultationAudio.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  if (count === 0) return 0

  /*
   * The delete has already happened by here, so a failing audit write would
   * mean recordings destroyed with nothing saying so. Reported rather than
   * swallowed: allowlisted fields only, never the error text, and never which
   * consultations were swept.
   */
  try {
    await recordAuditEvent({ action: 'audio.swept', metadata: { count } })
  } catch (error) {
    logger.warn('audio sweep audit failed', {
      outcome: 'error',
      errorName: error instanceof Error ? error.name : 'Error',
    })
  }
  return count
}
