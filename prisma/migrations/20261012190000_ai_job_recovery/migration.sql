ALTER TABLE "AnalysisJob" ADD COLUMN "reservationDay" DATE;

-- Existing reservations predate per-job reservation tracking. They cannot be
-- released safely by migration because a budget row may mix active and leaked
-- amounts. The reviewed production recovery runbook reconciles them explicitly.
CREATE INDEX "AnalysisJob_status_leaseExpiresAt_idx"
  ON "AnalysisJob"("status", "leaseExpiresAt");
