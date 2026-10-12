# AI Production Recovery Runbook

**Do not run this automatically.** This procedure changes production job and budget rows and requires explicit approval, an operator, a verified backup, and a maintenance window. It does not change the configured AI budget.

## Preconditions

1. Repair branch has been reviewed, merged, and its exact commit approved for deployment.
2. Record current `AI_DAILY_BUDGET_USD`, `AI_BATCH_BUDGET_USD`, retry count, model, and worker interval without printing secrets. Do not raise them.
3. Confirm no deployment is active and identify an operator/rollback owner.
4. Announce a short AI-processing maintenance window. ClickUp sync and the read-only dashboard may remain available.
5. Confirm at least twice the current database size is available for backup and that the last backup is readable.

## Step 1 — Capture preflight evidence (read-only)

Run the queries in `docs/audits/windows-test-guide.md` and save counts/timestamps. Additionally:

```sql
SELECT status, count(*), min("leaseExpiresAt"), max("leaseExpiresAt")
FROM "AnalysisJob" GROUP BY status ORDER BY status;

SELECT attempts, count(*)
FROM "AnalysisJob" WHERE status='LEASED'
GROUP BY attempts ORDER BY attempts;

SELECT day, "reservedUsd", "actualEstimatedUsd", "successfulJobs", "failedJobs"
FROM "AiBudgetDay" ORDER BY day DESC LIMIT 7;

SELECT count(*) AS analyzed FROM "TaskIntelligence";
SELECT count(*) AS active_tasks FROM "Task" WHERE NOT deleted;
```

Expected legacy shape from the audit: approximately 70 leased and 499 paused. Stop if counts differ materially or any lease is currently unexpired/actively owned.

## Step 2 — Backup and verify

1. Run the existing locked production backup before extracting or migrating the new release.
2. Confirm the dump is nonzero, owned/readable only by the intended operator, and `pg_restore --list` succeeds.
3. Copy the backup to approved encrypted off-host storage if available.
4. Record filename, UTC timestamp, size, database version, current deployed SHA, and target SHA.

Do not proceed if backup verification fails.

## Step 3 — Stop only the AI worker

```powershell
ssh.exe -i $SshKey -o StrictHostKeyChecking=yes ubuntu@34.224.54.213 'cd /opt/ami-clickup-assistant && sudo docker compose -f docker-compose.prod.yml stop ai-worker'
```

Verify no AI worker container/process remains active. This prevents new leases while accounting is reconciled. Do not stop PostgreSQL.

## Step 4 — Deploy code and additive migration

Use the reviewed deployment workflow. The migration only adds nullable `reservationDay` and an index. Do not start the AI worker yet if using a manual maintenance deployment. Verify the deployed SHA and schema column/index.

The normal workflow currently starts all services; for this recovery, use a reviewed maintenance variant or immediately stop AI before reconciliation. Do not improvise commands during the window.

## Step 5 — Reconcile legacy leases and reservations

First repeat the preflight queries. Substitute the configured retry limit below; do not assume `3` if production differs.

Run as one transaction while the AI worker is stopped:

```sql
BEGIN;

-- Review targets before changing them.
SELECT id, attempts, "leaseOwner", "leaseExpiresAt", "estimatedReservedUsd"
FROM "AnalysisJob"
WHERE status='LEASED'
ORDER BY id
FOR UPDATE;

-- Exhausted interrupted jobs become terminal and visible.
UPDATE "AnalysisJob"
SET status='FAILED',
    "leaseOwner"=NULL,
    "leaseExpiresAt"=NULL,
    "reservationDay"=NULL,
    "estimatedReservedUsd"=0,
    "completedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "lastError"='Recovered legacy expired lease after maximum attempts'
WHERE status='LEASED' AND attempts >= :approved_max_retries;

-- Retryable interrupted jobs return to the queue without consuming a new attempt yet.
UPDATE "AnalysisJob"
SET status='PENDING',
    "leaseOwner"=NULL,
    "leaseExpiresAt"=NULL,
    "reservationDay"=NULL,
    "estimatedReservedUsd"=0,
    "nextAttemptAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "completedAt"=NULL,
    "lastError"='Recovered legacy expired lease for retry'
WHERE status='LEASED' AND attempts < :approved_max_retries;

-- Rebuild each budget reservation from active, attributable leases only.
UPDATE "AiBudgetDay" b
SET "reservedUsd" = COALESCE((
  SELECT SUM(j."estimatedReservedUsd")
  FROM "AnalysisJob" j
  WHERE j.status='LEASED' AND j."reservationDay"=b.day
), 0),
"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

-- Safety assertions: these must return zero rows / true before COMMIT.
SELECT count(*) FROM "AnalysisJob" WHERE status='LEASED' AND "reservationDay" IS NULL;
SELECT bool_and("reservedUsd" >= 0 AND "actualEstimatedUsd" + "reservedUsd" <= :approved_daily_budget)
FROM "AiBudgetDay";

-- Operator chooses COMMIT only after checking affected counts.
COMMIT;
```

Use the SQL client’s variable mechanism for the approved numeric values; do not paste the colon placeholders literally. If any assertion fails, issue `ROLLBACK`, preserve evidence, and stop.

Do **not** immediately move all 499 `PAUSED_BUDGET` jobs to pending. Their `nextAttemptAt` preserves the spending boundary. The repaired worker will resume them when due.

## Step 6 — Controlled restart

1. Start one AI worker replica only.
2. Confirm heartbeat becomes `PROCESSING` or `IDLE` within five minutes.
3. Confirm `/api/health` becomes 200 only when stale leases are gone and the worker is current.
4. Observe one batch without changing budget limits.
5. Verify after every completed/failed job:

```sql
SELECT status, count(*) FROM "AnalysisJob" GROUP BY status ORDER BY status;
SELECT day, "reservedUsd", "actualEstimatedUsd", "successfulJobs", "failedJobs"
FROM "AiBudgetDay" ORDER BY day DESC LIMIT 2;
SELECT count(*) FROM "AnalysisJob"
WHERE status='LEASED' AND "leaseExpiresAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
```

Expected: no expired leases; reserved amount rises only for active work and falls on completion/failure; actual spend increases by measured usage; `actual + reserved` stays at or below the unchanged daily limit.

## Step 7 — Monitor backlog and coverage

For the first hour check every 5–10 minutes; then hourly for 24 hours:

- heartbeat age/status and last error;
- leased/pending/paused/succeeded/failed counts;
- oldest eligible job;
- actual plus reserved versus cap;
- task intelligence coverage;
- application/container logs for lost lease, serialization retry, provider errors, and restarts;
- host RAM, swap, disk, and container restarts.

Backlog will not clear instantly because spending controls remain intact. Success means bounded steady progress without stale leases or reservation drift, not bypassing the cap.

## Stop/rollback conditions

Stop the AI worker immediately if:

- `actualEstimatedUsd + reservedUsd` exceeds the configured limit;
- reservations do not fall after terminal transitions;
- expired leases reappear for more than two cycles;
- duplicate intelligence/provider calls are observed;
- health remains 503 for an unexplained reason;
- database errors, rapid retries, memory pressure, or unexpected spend occur.

Application rollback: stop AI, redeploy the prior known-good image/SHA, and leave the additive nullable column in place. Data rollback is not automatic: restoring the full backup would also discard legitimate sync/intelligence changes since the backup. Prefer a reviewed targeted correction; restore the full dump only under the incident owner’s decision and documented data-loss window.

## Completion criteria

- Zero expired leased jobs for 24 hours.
- Reservation ledger matches the sum of active per-job reservations.
- Actual plus reserved never exceeds the unchanged daily cap.
- Paused jobs resume only on schedule; retry attempts remain bounded.
- Intelligence coverage increases at the expected budget-limited rate.
- Health detects an intentionally stopped/stale worker during a controlled test and recovers after restart.
- Backup, evidence, affected-row counts, deployed SHA, and operator approval are recorded.
