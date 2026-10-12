# AI Pipeline Independent Pre-deployment Review

Reviewed branch: `fix/ai-pipeline-recovery`  
Reviewed baseline: latest `origin/main` at `7d84c46135407ef6f4e4b79b4827b5225ae247f4`  
Original repair commit: `e1454c7`  
Production activity: none

## Final recommendation

**GO only for the controlled maintenance deployment and reconciliation sequence below. NO-GO for an ordinary unattended push-to-main deployment.** The legacy reconciliation has been exercised in the isolated PostgreSQL database with 70 leased and 499 paused jobs. It must still receive explicit production-write approval and be executed while the old AI worker is stopped.

## Confirmed findings and disposition

1. **Migration is additive and backward compatible — confirmed.** `prisma/migrations/20261012190000_ai_job_recovery/migration.sql:1-7` adds one nullable date column and an index. Existing records remain valid; no table rewrite/default/backfill guesses a reservation owner. Risk: Low schema risk, Medium index-build lock risk at the current small `AnalysisJob` size.
2. **Legacy rows cannot be automatically released by new code — intentional.** Existing leases have `reservationDay=NULL`; `scripts/continuous-ai-worker.ts:61-66` refuses to release an unattributed reservation. The maintenance transaction must clear the old jobs and rebuild the ledger before deployment.
3. **Budget admission is atomic.** `scripts/continuous-ai-worker.ts:123-141` locks one pending job and conditionally updates the single UTC budget row inside a serializable transaction. The predicate includes actual + reserved + request. Concurrent PostgreSQL tests pass.
4. **Serialization errors needed retry — defect found and fixed during review.** Concurrent completion originally produced PostgreSQL `40001`. `scripts/continuous-ai-worker.ts:44-59` now retries only Prisma serialization/deadlock errors, at most three attempts; unrelated errors fail closed.
5. **Long calls needed lease renewal — defect found and fixed.** `scripts/continuous-ai-worker.ts:145-174` renews only the owning lease and heartbeat every 30–60 seconds. `:201` wraps the model call. A lost lease prevents result persistence.
6. **Cached crash recovery undercounted spend — defect found and fixed.** The original repair finalized a previously saved result at $0. `scripts/continuous-ai-worker.ts:190-198,223-231` now converts the full reservation to actual estimated spend when token counts were not persisted. This is conservative and cannot weaken the cap.
7. **Idempotency is layered, not absolute.** `lib/intelligence/ai.ts:109,133` sends a deterministic provider key; the worker also short-circuits an already-saved matching fingerprint and checks lease ownership. A distributed transaction with the provider is impossible, so the conservative reservation charge covers the remaining ambiguous crash window.
8. **UTC behavior is explicit.** `scripts/continuous-ai-worker.ts:77,130` uses `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` for naive Prisma timestamp comparisons. The isolated non-UTC session reproduced the prior error and validates the fix. Reservation ownership is a UTC `DATE` (`prisma/schema.prisma:155`).
9. **Expected startup no longer creates a false queue failure.** `lib/intelligence/worker-state.ts:42-55` treats a fresh `PROCESSING` heartbeat as active progress even when the backlog/last success are old. Missing/stale/failed heartbeat and expired leases still make `/api/health` return 503 (`app/api/health/route.ts:9-20`).
10. **499 paused jobs remain bounded.** Reconciliation does not change their state or `nextAttemptAt`. When due, admission still checks the unchanged daily limit. The exact 70/499 test confirms all 499 remain paused.

## Migration risk assessment

| Risk | Rating | Control |
|---|---|---|
| Adding nullable `reservationDay` | Low | No default/backfill; old code ignores it |
| Composite index build | Low–Medium | Current job table is small; deploy in maintenance window; observe lock wait |
| New code against old schema | High | Never start new worker before migration |
| Old code after ledger reconciliation | High | Do not restart old AI worker; it still leaks reservations |
| Migration rollback | Low | Column/index are additive; leave them in place during application rollback |
| Legacy data reconciliation | Medium–High | Stop worker, verified backup, one reviewed transaction, assertions before commit, isolated 70/499 test |

## Exact deployment and reconciliation order

1. Obtain explicit approval for production writes and record operator, old SHA, target SHA, unchanged daily/batch limits, model, retry limit, and maintenance start time.
2. Read-only preflight: job counts by state/attempt, lease expiry/owner, seven budget rows, heartbeat, coverage, disk, containers, deployed SHA.
3. Stop if any result materially differs from the audited 70 leased/499 paused shape; investigate before adapting SQL.
4. Run and verify a fresh database backup (`pg_restore --list`); preserve it off-host if approved.
5. Gracefully stop only the **old** AI worker with a 1,800-second timeout. Do not stop PostgreSQL, web, or sync.
6. Verify the worker is stopped. Repeat lease query. If any unexpired lease remains, stop: its provider outcome is ambiguous and requires individual review.
7. On the **old schema**, begin one SQL transaction and lock all leased rows.
8. Mark leased rows with `attempts >= approved_max_retries` as `FAILED`; clear lease/reservation fields and record the recovery reason.
9. Move leased rows below the retry limit to `PENDING`; clear lease/reservation fields and make them eligible without incrementing attempts.
10. Assert `LEASED=0`. Only then reset `AiBudgetDay.reservedUsd=0`; do not alter actual spend, daily limits, paused jobs, or their schedule.
11. Assert every budget row is nonnegative and `actual + reserved <= approved_daily_budget`; review affected counts; commit. Otherwise rollback.
12. Deploy the reviewed release. The normal workflow takes another backup, applies the additive migration, starts services, verifies exact commit, and polls readiness.
13. Confirm schema column/index, current AI heartbeat, zero expired leases, and health 200.
14. Observe the first bounded batch and complete the post-deployment checklist.

## Pre-deployment checklist

- [ ] Branch/commit reviewed; diff is only intended repair, tests, migration, and documentation.
- [ ] `origin/main` SHA recorded; merge conflicts resolved by review, not automatic preference.
- [ ] Typecheck, complete unit suite, build, and isolated PostgreSQL integration test pass.
- [ ] Exact production retry limit and budgets recorded without changing or exposing them.
- [ ] No deployment or other AI worker operation is active.
- [ ] 70/499 counts and attempt distribution rechecked; any drift reviewed.
- [ ] No unexpired/actively owned lease before maintenance.
- [ ] Disk space sufficient; backup created and `pg_restore --list` passes.
- [ ] Rollback owner, maintenance window, prior SHA, and SSH access confirmed.
- [ ] Reconciliation SQL has numeric values substituted through the SQL client variable mechanism and reviewed by a second person.
- [ ] Operator understands that paused jobs stay paused and backlog clearance remains budget-limited.

## Post-deployment verification checklist

- [ ] `.deployed-commit` equals the approved target SHA.
- [ ] Migration history is clean; `reservationDay` column and composite index exist.
- [ ] Exactly one AI worker is running; heartbeat becomes `PROCESSING`/`IDLE` within five minutes.
- [ ] `/api/health` returns 200; intentional stop test later returns 503 after threshold.
- [ ] Expired lease count remains zero for at least two worker cycles.
- [ ] Every active lease has owner, future expiry, positive reservation, and `reservationDay`.
- [ ] Budget reserved amount equals the sum of active job reservations for the UTC day.
- [ ] Actual + reserved is at or below the unchanged daily limit.
- [ ] Terminal jobs have cleared owner/expiry/reservation.
- [ ] 499 paused jobs were not bulk-released; only due jobs move through admission.
- [ ] Retry counts do not exceed the configured maximum.
- [ ] Logs show no repeated serialization failures, lost leases, duplicate provider calls, migration errors, or rapid container restarts.
- [ ] Intelligence coverage rises at the expected budget-limited rate; no promise of immediate backlog clearance is made.

## Rollback triggers

- Actual + reserved exceeds the configured daily limit.
- Reservation total differs from attributable active leases.
- Any lease remains expired for more than two cycles.
- Duplicate AI execution or conflicting intelligence writes are observed.
- Repeated serialization failures exhaust three retries.
- Health remains 503 beyond five minutes without an explained, actively processing startup.
- AI worker crash loop, migration error, unexpected spend, database contention, OOM/swap pressure, or data inconsistency.

## Rollback procedure

1. Stop the AI worker immediately; leave PostgreSQL running.
2. Capture read-only counts, budget rows, heartbeat, logs, containers, and deployed SHA.
3. Do not raise limits, bulk retry, or manually zero reservations while an active lease exists.
4. Redeploy the prior known-good application SHA only if needed for web/sync continuity, but **do not restart its old AI worker**, which contains the original leak.
5. Leave the nullable column/index in place; removing them adds risk and is unnecessary.
6. Prefer a reviewed targeted repair. Restore the verified full backup only if the incident owner accepts losing all legitimate changes after its timestamp.
7. Re-run ledger and job-state assertions before any later AI restart.

## Tests executed in this review

- TypeScript check: PASS.
- Worker state/readiness suite: PASS.
- Isolated PostgreSQL integration: PASS, including concurrent lease/completion, serialization retry, renewal ownership, conservative cached-result charge, UTC behavior, and exact 70/499 reconciliation.
- Full existing test suite and Next.js production build: rerun after final changes and recorded in the handoff.

## Remaining limitations

- Provider-side idempotency retention/semantics are an external dependency; fingerprint and conservative accounting provide local defense.
- A second human should review substituted production SQL and affected-row counts before commit.
- Lease renewal depends on the Node event loop; a completely frozen process cannot renew, and another worker will recover only after expiry as designed.
- The standard workflow cannot perform the pre-migration legacy transaction. The operator must complete Steps 1–11 first; therefore an ordinary push without maintenance is NO-GO.
