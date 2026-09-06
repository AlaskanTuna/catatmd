-- AddEnum
CREATE TYPE "NoteTemplate" AS ENUM ('soap', 'malaysian');

-- AlterTable
ALTER TABLE "consultation"
ADD COLUMN "noteTemplate" "NoteTemplate" NOT NULL DEFAULT 'soap',
ADD COLUMN "editedMedicalRecordNote" JSONB;
