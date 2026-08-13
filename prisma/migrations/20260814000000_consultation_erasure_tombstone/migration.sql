-- AlterTable
ALTER TABLE "consultation" ADD COLUMN "erasedAt" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "audit_event" DROP CONSTRAINT "audit_event_consultationId_fkey";

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
