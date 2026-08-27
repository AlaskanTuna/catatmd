-- AlterTable
--
-- Adopted clinical-records retention period, in whole years (#80). Nullable,
-- and null is the meaningful default: it means the data controller has not yet
-- reviewed and adopted a period. Nothing enforces this column. There is no
-- retention job, no TTL and no deletion sweep, so it records the decision only.
ALTER TABLE "user" ADD COLUMN "retentionYears" INTEGER;
