# AI Pipeline Repair — Root Cause and Validation

Branch: `fix/ai-pipeline-recovery`  
Base: local `main` at `2f4a63c` (audit commit on top of audited production `7d84c46`)  
Production changes: none

## Confirmed root causes

### 1. Reservations were accumulated, never settled

The former lease transaction increased `AiBudgetDay.reservedUsd`. Neither the success nor failure transaction decreased it. Because admission checked only `reservedUsd + request <= dailyBudget`, completed work permanently consumed the in-application allowance. Production’s $1.996800 reserved versus $0.238709 actual is consistent with this defect.

The fix treats budget as a ledger invariant: `actualEstimatedUsd + active reservedUsd + next reservation <= daily limit`. Completion atomically releases the reservation and adds actual usage; failure/interruption releases it without weakening the limit. `GREATEST(0, …)` prevents negative balances during defensive reconciliation.

### 2. Exhausted expired leases were unreachable

The former selector allowed expired `LEASED` jobs only when `attempts < maxRetries`. Once an interrupted job reached the retry limit, no code selected or terminalized it. It stayed `LEASED` indefinitely.

The fix runs recovery before new leasing. It locks expired jobs with `FOR UPDATE SKIP LOCKED`, releases their exact reservation, returns retryable jobs to `PENDING`, and marks exhausted jobs `FAILED`. Recovery is bounded in batches of 50 and safe with multiple workers.

### 3. A reservation had no owning budget day

`estimatedReservedUsd` existed on a job, but not the day whose budget row owned that amount. A job crossing midnight or recovered later could not safely release the right row. The additive migration introduces nullable `AnalysisJob.reservationDay`. New leases always set it; every terminal transition clears it and resets the job reservation to zero.

Existing production rows intentionally remain null. Guessing their budget day in a migration would risk corrupting accounting; the separate recovery runbook reconciles them while the worker is stopped.

### 4. Crash window could cause duplicate paid analysis

Intelligence persistence and job completion are separate transactions. A crash after saving intelligence but before completing the job causes a retry. The fix writes the source fingerprint onto the leased job, uses a deterministic provider idempotency key for the job/source pair, and checks for already-saved matching intelligence before calling the model. It also verifies lease ownership before saving a returned result.

There remains an unavoidable narrow uncertainty if a provider completes a request but both provider idempotency and local persistence fail. The hard budget reservation still bounds financial exposure.

### 5. Raw timestamp comparisons were timezone-sensitive

Prisma `DateTime` migrations use PostgreSQL `TIMESTAMP(3)` without timezone. Comparing those fields to timezone-aware `NOW()` can shift the comparison when the database session is not UTC. The isolated test database reproduced this: a visibly one-minute-old lease evaluated as not expired. Recovery and lease eligibility now compare against `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`.

### 6. Health represented database liveness, not pipeline readiness

The old endpoint ran `SELECT 1`. The fix checks AI heartbeat presence/status/age, expired leases, and an old eligible queue with no recent successful worker cycle. It returns 503 with stable reason codes when the AI pipeline is not ready. A current worker that is intentionally budget-limited does not fail merely because backlog exists.

The worker now reports `PROCESSING` at cycle start and refreshes `lastSeenAt` after each job, making long cycles observable.

## State-transition invariants

- Only `PENDING` jobs may acquire a new lease.
- Lease acquisition, reservation, attempt increment, owner, expiry, and reservation day occur in one serializable transaction.
- `actual + reserved` never intentionally exceeds the configured daily cap.
- A job owns at most one reservation, on exactly one UTC budget day.
- Completion/failure/recovery release the reservation in the same transaction as the job state change.
- Expired jobs either return to `PENDING` or become terminal `FAILED`; none remain unreachable.
- A worker may finalize only a lease it still owns.
- `PAUSED_BUDGET` jobs resume no earlier than their existing next UTC budget day.

## Validation performed

| Check | Result |
|---|---|
| Prisma schema validation | PASS (`prisma validate`). A standalone `prisma generate` attempt could not replace the Windows query-engine DLL because another local process held it; build, typecheck, migrations, and the generated client used by integration tests all completed |
| TypeScript `tsc --noEmit` | PASS |
| Full Next.js production build | PASS |
| Existing deterministic test suites | PASS |
| New worker state regression suite | PASS |
| Isolated PostgreSQL integration suite | PASS |

The isolated database is local-only and named `ami_assistant_ai_worker_test_20261012`. The integration script refuses non-local hosts and database names outside `ami_assistant_ai_worker_test_*`.

Covered cases:

- interrupted lease below retry limit returns to pending;
- interrupted lease at retry limit becomes failed;
- reservations are released atomically and never negative;
- daily admission includes actual plus active reservations;
- completion converts reservation to actual spend;
- same job/source produces a stable idempotency key;
- missing/stale/failed heartbeat and stale leases make readiness fail;
- current budget-limited worker does not fail solely because backlog is old;
- UTC timestamp behavior is correct on a non-UTC database session.
- lease ownership is renewed during long model requests and cannot be renewed after completion;
- concurrent lease/completion transactions retry PostgreSQL serialization failures without exceeding the cap;
- a crash after intelligence persistence conservatively converts the full reservation to actual spend rather than recording zero;
- the audited production shape of 70 legacy leases and 499 paused jobs reconciles to zero leases, 35 bounded retries, 35 terminal failures, 499 still paused, zero reservation leakage, and unchanged actual spend in the isolated database.

## Remaining risks

- Production legacy jobs have no `reservationDay`; they require the reviewed reconciliation procedure, not automatic guessing.
- OpenAI idempotency behavior should be confirmed against the deployed SDK/API contract before rollout; local fingerprint short-circuit remains useful independently.
- The AI model call and intelligence/job database updates cannot be one distributed transaction.
- Health thresholds need observation under normal workloads; defaults are five minutes for heartbeat and 24 hours for an old eligible queue without a successful cycle.
- Only one local concurrent-worker scenario is covered by row-lock semantics; add stress testing before materially increasing worker replicas.
- The migration is additive, but deployment readiness will correctly remain red until legacy stale leases are reconciled.
