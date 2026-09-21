-- A new consultation opens in ambient capture rather than press-to-record
-- (#378, docs/decisions.md D-007).
--
-- SET DEFAULT and nothing else, deliberately. Existing rows keep the mode they
-- were created with, including the ones 20260907000000_add_note_template
-- backfilled to 'manual'. A consultation's capture mode is a record of how its
-- audio was or will be taken, so rewriting it for rows already captured would
-- make the column say something that did not happen.

-- AlterTable
ALTER TABLE "consultation" ALTER COLUMN "captureMode" SET DEFAULT 'ambient';
