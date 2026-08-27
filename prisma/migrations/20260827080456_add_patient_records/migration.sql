-- CreateEnum
CREATE TYPE "PatientGender" AS ENUM ('male', 'female', 'other');

-- AlterTable
ALTER TABLE "consultation" ADD COLUMN     "patientId" TEXT;

-- CreateTable
CREATE TABLE "patient" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "name" TEXT,
    "nric" TEXT,
    "age" INTEGER,
    "gender" "PatientGender",
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_doctorId_createdAt_idx" ON "patient"("doctorId", "createdAt");

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
