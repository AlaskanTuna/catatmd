-- AlterTable
ALTER TABLE "audit_event" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_seq_key" ON "audit_event"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_prevHash_key" ON "audit_event"("prevHash");

