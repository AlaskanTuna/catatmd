-- The consultation recording, kept only while the doctor may still need it to
-- check what the recogniser wrote (#293).
--
-- A table of its own rather than a column on "consultation": a bytea column
-- would be read by every query that does not name an explicit select, and
-- erasure here is a real delete rather than the tombstone the clinical columns
-- take.
--
-- ON DELETE CASCADE is correct and inert. Consultations are tombstoned, never
-- hard-deleted, so this fires only if a row is ever removed outright, and in
-- that case the recording must not outlive it.

-- CreateTable
CREATE TABLE "consultation_audio" (
    "consultationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_audio_pkey" PRIMARY KEY ("consultationId")
);

-- CreateIndex
CREATE INDEX "consultation_audio_expiresAt_idx" ON "consultation_audio"("expiresAt");

-- AddForeignKey
ALTER TABLE "consultation_audio" ADD CONSTRAINT "consultation_audio_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
