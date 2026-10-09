CREATE TYPE "AttentionDecision" AS ENUM ('REVIEWED', 'DISMISSED');

CREATE TABLE "AttentionDisposition" (
  "id" SERIAL NOT NULL,
  "taskId" INTEGER NOT NULL,
  "decision" "AttentionDecision" NOT NULL,
  "sourceFingerprint" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttentionDisposition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttentionDisposition_taskId_key" ON "AttentionDisposition"("taskId");
ALTER TABLE "AttentionDisposition" ADD CONSTRAINT "AttentionDisposition_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
