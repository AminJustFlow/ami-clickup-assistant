# Controlled AI pipeline production release

Reviewed repair commit: `81b5d8737d3ac42f752b53d2c406953cde2616aa`
Production baseline: `7d84c46135407ef6f4e4b79b4827b5225ae247f4`

This procedure prepares the release but does not authorize a merge, deployment,
service stop, database write, or budget change.

## Release controls

- Normal production deployment is fail-closed until
  `/opt/ami-clickup-assistant/.ai-pipeline-recovery-complete` exists.
- The normal and recovery workflows share the
  `ami-clickup-assistant-production` GitHub Actions concurrency group.
- Both workflows take `/tmp/ami-clickup-deploy.lock` on the host.
- Recovery verifies the exact deployed SHA before doing anything, takes and
  validates a database backup, then gracefully stops the old AI worker.
- `docker compose stop` records an explicit stopped state for an
  `unless-stopped` container. A daemon restart will not restart it. A later
  `docker compose up`, container recreation, or direct operator action can;
  therefore freeze merges and direct production operations for the window.
- Reconciliation and deployment run in one SSH session while the host lock is
  held. The worker is not started until reconciliation and migration succeed.
- The recovery-complete marker is written only after the replacement web and AI
  worker pass the internal health endpoint. External health is checked next.

## Read-only preflight

Run from the reviewed branch before approving the recovery workflow:

```powershell
Get-Content -Raw deploy/ai-recovery-preflight.sh | ssh -i $env:USERPROFILE\.ssh\ami-production ubuntu@34.224.54.213 'bash -s'
```

The script reads only Docker state and PostgreSQL data. It reports the deployed
commit, container state and restart policy, job counts, LEASED retry/expiry
counts, seven days of reserved and actual spend, worker heartbeat age, task
coverage, applied/unfinished migrations, and the recovery marker. Save the full
output with a UTC timestamp. Do not put `.env.production` or database passwords
in the report.

## Approval checkpoints

1. **Release-content approval:** confirm the draft PR diff, reviewed repair
   commit ancestry, CI, and production baseline. Merging remains separately
   prohibited until explicitly approved.
2. **Change freeze approval:** freeze merges to `main`, cancel or let finish all
   queued/running production-concurrency runs, and prohibit direct Compose
   operations for the maintenance window.
3. **Preflight approval (read-only):** run the preflight twice several minutes
   apart. Record exact LEASED, PAUSED_BUDGET, retryable/exhausted, unexpired
   lease, budget, worker, heartbeat, and migration values. Any changing counts
   require a new review.
4. **Recovery-input approval:** independently verify that
   `retryable + exhausted = leased`, all legacy leases are expired, the current
   budget is unchanged, and `expected_deployed_sha` is exact. A reviewer enters
   `APPROVE_AI_PIPELINE_RECOVERY` and approves the protected production
   environment. This is the final checkpoint before production writes.
5. **Post-recovery approval:** review reconciliation output, migrations,
   internal/external health, spend, retry rate, and job-state changes before
   lifting the change freeze.

## Reconciliation guarantees

`deploy/ai-recovery-reconcile.sql` uses `ON_ERROR_STOP`, one PostgreSQL
transaction, and a transaction-scoped advisory lock. Before updates it asserts:

- exact LEASED, PAUSED_BUDGET, retryable, and exhausted counts;
- no unexpired LEASED job;
- nonnegative reserved and actual spending; and
- the exact approval phrase.

It records affected rows and asserts they equal the approved counts. Before
commit it asserts zero LEASED jobs, unchanged PAUSED_BUDGET and actual-spend
totals, and `actual + reserved <= approved existing daily budget` for every
budget day. Any assertion or SQL error terminates `psql`; PostgreSQL rolls back
the open transaction. The script never raises the limit and never resumes
PAUSED_BUDGET jobs.

## Exact maintenance order

1. Complete checkpoints 1–3 and keep the GitHub production environment locked.
2. Confirm no run is active or queued in the shared concurrency group.
3. Dispatch `Controlled AI pipeline recovery` with the frozen preflight values.
4. Approve its production-environment gate only after checkpoint 4.
5. Workflow verifies source/tests, takes the host lock, checks the exact
   production SHA, reruns preflight, creates and validates a `pg_dump` backup,
   then stops the old AI worker with a 30-minute graceful timeout.
6. It proves the worker is stopped and reruns preflight. A mismatched count or
   still-running worker aborts before reconciliation.
7. Reconcile legacy LEASED jobs transactionally. PAUSED_BUDGET jobs stay paused
   and become eligible only through normal budget-aware recovery after deploy.
8. Extract the reviewed release, build, migrate, start services, and verify
   internal health. Only then write the recovery marker.
9. Verify the exact deployed SHA and external HTTPS health.
10. Run read-only postflight queries and observe before lifting the freeze.

If execution fails after reconciliation but before deployment completes, leave
the worker stopped. Do not reuse old expected counts. Inspect the validated
backup, rerun read-only preflight, review the new zero-LEASED state, and either
resume deployment under a newly approved run or restore the backup per the
production recovery runbook.

## Resuming normal GitHub Actions deployment

1. Confirm the controlled workflow succeeded, the marker content names its SHA,
   the deployed SHA matches, migrations are finished, health is good, no stale
   lease exists, and spending remains within the unchanged limit.
2. Check the Actions queue again. Cancel obsolete queued deploys; review any run
   for a newer `main` SHA before allowing it to execute.
3. Lift the merge freeze only after post-recovery approval. Normal deploys then
   pass the recovery-marker gate and remain serialized by the shared Actions
   concurrency group and host lock.
4. Do not delete the marker. Removing it intentionally closes the normal
   production deployment gate again.

## Rollback triggers

Abort before writes for any SHA/count/lease/worker/migration/budget mismatch or
invalid backup. After writes, keep the worker stopped and invoke the recovery
runbook if migration fails, health does not recover, actual spending changes
during reconciliation, duplicate processing is observed, or budget invariants
fail. Never restore while application writers are running.
