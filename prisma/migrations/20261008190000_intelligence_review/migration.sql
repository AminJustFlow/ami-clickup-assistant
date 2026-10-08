CREATE TABLE "IntelligenceReview" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "notes" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntelligenceReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntelligenceReview_taskId_key" ON "IntelligenceReview"("taskId");
ALTER TABLE "IntelligenceReview" ADD CONSTRAINT "IntelligenceReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
