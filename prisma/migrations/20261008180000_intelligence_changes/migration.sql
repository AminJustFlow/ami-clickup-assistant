CREATE TABLE "IntelligenceChange" (
  "id" SERIAL PRIMARY KEY,
  "taskId" INTEGER NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE,
  "previousState" "AgentState",
  "nextState" "AgentState" NOT NULL,
  "previousNeedsAmi" BOOLEAN,
  "nextNeedsAmi" BOOLEAN NOT NULL,
  "previousWaitingOnType" "WaitingOnType",
  "nextWaitingOnType" "WaitingOnType" NOT NULL,
  "summary" TEXT,
  "amiAction" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IntelligenceChange_detectedAt_idx" ON "IntelligenceChange"("detectedAt");
CREATE INDEX "IntelligenceChange_taskId_detectedAt_idx" ON "IntelligenceChange"("taskId", "detectedAt");
