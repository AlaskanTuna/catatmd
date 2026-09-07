-- AddEnum
CREATE TYPE "NoteTemplate" AS ENUM ('soap', 'malaysian');

CREATE TYPE "CaptureMode" AS ENUM ('ambient', 'manual');

-- AlterTable
ALTER TABLE "consultation"
ADD COLUMN "noteTemplate" "NoteTemplate" NOT NULL DEFAULT 'soap',
ADD COLUMN "captureMode" "CaptureMode" NOT NULL DEFAULT 'manual',
ADD COLUMN "editedMedicalRecordNote" JSONB;
