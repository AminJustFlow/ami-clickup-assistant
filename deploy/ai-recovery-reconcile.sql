\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(41722);

CREATE TEMP TABLE recovery_expectations AS SELECT
  :'approval'::text AS approval,
  :expected_leased::integer AS expected_leased,
  :expected_paused::integer AS expected_paused,
  :expected_retryable::integer AS expected_retryable,
  :expected_exhausted::integer AS expected_exhausted,
  :max_retries::integer AS max_retries,
  :daily_budget::numeric AS daily_budget,
  (SELECT COALESCE(sum("actualEstimatedUsd"),0) FROM "AiBudgetDay") AS actual_before;

-- Any failed assertion raises division_by_zero. ON_ERROR_STOP then disconnects,
-- and PostgreSQL rolls back the open transaction automatically.
SELECT 1 / CASE WHEN approval='APPROVE_AI_PIPELINE_RECOVERY' THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED')=expected_leased THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='PAUSED_BUDGET')=expected_paused THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED' AND attempts < max_retries)=expected_retryable THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED' AND attempts >= max_retries)=expected_exhausted THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED' AND "leaseExpiresAt" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))=0 THEN 1 ELSE 0 END;
SELECT 1 / CASE WHEN NOT EXISTS(SELECT 1 FROM "AiBudgetDay" WHERE "reservedUsd" < 0 OR "actualEstimatedUsd" < 0) THEN 1 ELSE 0 END;

CREATE TEMP TABLE recovery_changes(kind text PRIMARY KEY, affected integer NOT NULL);

WITH changed AS (
  UPDATE "AnalysisJob"
  SET status='FAILED', "leaseOwner"=NULL, "leaseExpiresAt"=NULL,
      "estimatedReservedUsd"=0, "completedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "lastError"='Recovered legacy expired lease after maximum attempts'
  WHERE status='LEASED' AND attempts >= (SELECT max_retries FROM recovery_expectations)
  RETURNING 1
)
INSERT INTO recovery_changes SELECT 'exhausted', count(*) FROM changed;

WITH changed AS (
  UPDATE "AnalysisJob"
  SET status='PENDING', "leaseOwner"=NULL, "leaseExpiresAt"=NULL,
      "estimatedReservedUsd"=0, "nextAttemptAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
      "completedAt"=NULL, "lastError"='Recovered legacy expired lease for retry'
  WHERE status='LEASED' AND attempts < (SELECT max_retries FROM recovery_expectations)
  RETURNING 1
)
INSERT INTO recovery_changes SELECT 'retryable', count(*) FROM changed;

SELECT 1 / CASE WHEN (SELECT affected FROM recovery_changes WHERE kind='retryable')=expected_retryable THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT affected FROM recovery_changes WHERE kind='exhausted')=expected_exhausted THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED')=0 THEN 1 ELSE 0 END;

UPDATE "AiBudgetDay" SET "reservedUsd"=0, "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

SELECT 1 / CASE WHEN (SELECT count(*) FROM "AnalysisJob" WHERE status='PAUSED_BUDGET')=expected_paused THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN (SELECT COALESCE(sum("actualEstimatedUsd"),0) FROM "AiBudgetDay")=actual_before THEN 1 ELSE 0 END FROM recovery_expectations;
SELECT 1 / CASE WHEN NOT EXISTS(SELECT 1 FROM "AiBudgetDay", recovery_expectations WHERE "reservedUsd" < 0 OR "actualEstimatedUsd" + "reservedUsd" > daily_budget) THEN 1 ELSE 0 END;

TABLE recovery_changes;
SELECT status, count(*) FROM "AnalysisJob" GROUP BY status ORDER BY status;
SELECT day, "reservedUsd", "actualEstimatedUsd" FROM "AiBudgetDay" ORDER BY day DESC LIMIT 7;
COMMIT;
