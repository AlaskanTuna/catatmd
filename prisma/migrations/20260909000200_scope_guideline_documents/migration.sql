-- Retrieval scope (#220): a document is retrievable only for the clinical
-- profiles it is tagged with, so an off-topic guideline can never enter the
-- citation candidate set. Empty means never retrievable, which is the safe
-- default for anything ingested before it was scoped.
ALTER TABLE "guideline_document" ADD COLUMN "profiles" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "guideline_document" ADD COLUMN "verbatimAllowed" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "guideline_document_profiles_idx" ON "guideline_document" USING GIN ("profiles");
