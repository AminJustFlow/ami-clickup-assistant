ALTER TABLE "TaskIntelligence"
  ADD COLUMN "nextActor" TEXT,
  ADD COLUMN "unresolvedRequest" TEXT,
  ADD COLUMN "priorityLevel" TEXT,
  ADD COLUMN "priorityReasons" JSONB,
  ADD COLUMN "evidenceReferences" JSONB,
  ADD COLUMN "contradictingEvidence" JSONB,
  ADD COLUMN "freshnessStatus" TEXT,
  ADD COLUMN "verificationStatus" TEXT,
  ADD COLUMN "verificationReasons" JSONB,
  ADD COLUMN "classificationVersion" TEXT;
