ALTER TABLE "AnalysisJob" ADD COLUMN "recoveryDay" DATE;
ALTER TABLE "AnalysisJob" ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "AnalysisJob_recoveryDay_idx" ON "AnalysisJob"("recoveryDay");
