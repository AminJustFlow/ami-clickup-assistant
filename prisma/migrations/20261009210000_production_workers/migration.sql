CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'PAUSED_BUDGET');

CREATE TABLE "AnalysisJob" (
  "id" SERIAL PRIMARY KEY, "taskId" INTEGER NOT NULL UNIQUE REFERENCES "Task"("id") ON DELETE CASCADE,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING', "sourceFingerprint" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT, "leaseExpiresAt" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT, "estimatedReservedUsd" DECIMAL(12,6) NOT NULL DEFAULT 0, "actualInputTokens" INTEGER,
  "actualOutputTokens" INTEGER, "actualEstimatedUsd" DECIMAL(12,6), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AnalysisJob_status_nextAttemptAt_idx" ON "AnalysisJob"("status", "nextAttemptAt");
CREATE INDEX "AnalysisJob_leaseExpiresAt_idx" ON "AnalysisJob"("leaseExpiresAt");

CREATE TABLE "AiBudgetDay" (
  "day" DATE PRIMARY KEY, "reservedUsd" DECIMAL(12,6) NOT NULL DEFAULT 0, "actualEstimatedUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "inputTokens" BIGINT NOT NULL DEFAULT 0, "outputTokens" BIGINT NOT NULL DEFAULT 0, "successfulJobs" INTEGER NOT NULL DEFAULT 0,
  "failedJobs" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WorkerHeartbeat" (
  "name" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "lastStartedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3), "lastError" TEXT, "metadata" JSONB
);
CREATE TABLE "SyncRun" (
  "id" SERIAL PRIMARY KEY, "clientId" INTEGER, "status" TEXT NOT NULL, "scanned" INTEGER NOT NULL DEFAULT 0,
  "refreshed" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3)
);
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");
CREATE INDEX "SyncRun_clientId_startedAt_idx" ON "SyncRun"("clientId", "startedAt");
