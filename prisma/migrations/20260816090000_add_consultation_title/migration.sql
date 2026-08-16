-- The record's filing name, replacing the created timestamp as its identity.
--
-- PHI-bearing, and the fourth erasure target. It is derived from the analysis
-- on first run and freely editable afterwards, so it holds a patient name
-- whenever one is the useful thing to file under. `eraseConsultation`
-- (backend/src/audit/erasure.ts) nulls it alongside `transcript`, `analysis`
-- and `editedNote`.
--
-- Nullable with no default and no backfill. NULL means never named, and the UI
-- falls back to `createdAt` rather than storing one, so existing rows keep
-- rendering exactly as they do today and a non-NULL value always means somebody
-- or something chose it.

-- AlterTable
ALTER TABLE "consultation" ADD COLUMN     "title" TEXT;
