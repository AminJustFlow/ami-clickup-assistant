CREATE TABLE "OperationalUpdate" (
  "id" SERIAL NOT NULL,
  "taskId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "impact" TEXT,
  "evidenceAt" TIMESTAMP(3),
  "sourceFingerprint" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalUpdate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationalUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperationalUpdate_taskId_sourceFingerprint_key" ON "OperationalUpdate"("taskId", "sourceFingerprint");
CREATE INDEX "OperationalUpdate_evidenceAt_idx" ON "OperationalUpdate"("evidenceAt");
CREATE INDEX "OperationalUpdate_kind_evidenceAt_idx" ON "OperationalUpdate"("kind", "evidenceAt");

CREATE TABLE "WorkdayBrief" (
  "id" SERIAL NOT NULL,
  "day" DATE NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkdayBrief_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkdayBrief_day_key" ON "WorkdayBrief"("day");

CREATE TABLE "BriefItemReview" (
  "id" SERIAL NOT NULL,
  "day" DATE NOT NULL,
  "itemKey" TEXT NOT NULL,
  "taskId" INTEGER,
  "sourceFingerprint" TEXT,
  "decision" TEXT NOT NULL DEFAULT 'DONE_TODAY',
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BriefItemReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BriefItemReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BriefItemReview_day_itemKey_key" ON "BriefItemReview"("day", "itemKey");
CREATE INDEX "BriefItemReview_taskId_day_idx" ON "BriefItemReview"("taskId", "day");

CREATE TABLE "EntityReviewCheckpoint" (
  "id" SERIAL NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityKey" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityReviewCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntityReviewCheckpoint_entityType_entityKey_key" ON "EntityReviewCheckpoint"("entityType", "entityKey");
