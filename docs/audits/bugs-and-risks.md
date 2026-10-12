# Confirmed Bugs and Risks

## P0 — AI budget reservation leakage and permanently leased jobs

- **Type:** confirmed defect; **priority:** Critical; **effort:** 1–2 days; **pre-production:** yes.
- **Evidence:** `scripts/continuous-ai-worker.ts:66` increments `reservedUsd`. Success (`:98-101`) and failure (`:106-109`) update actual usage/counters but never decrement it. Lease selection (`:61-63`) excludes expired jobs once attempts reaches `maxRetries`, but nothing changes them to `FAILED`.
- **Production evidence:** 70 `LEASED` jobs have dates beginning 2026-10-09; 499 are `PAUSED_BUDGET`; the current budget row showed actual $0.238709, reserved $1.996800, 238 successes, zero failures.
- **Impact:** work stops far below the intended spend cap; jobs can remain permanently nonterminal; dashboard intelligence becomes stale/incomplete while health remains green.
- **Reproduction:** seed a job; lease it; complete it; observe `reservedUsd` unchanged. Set an expired leased job to `attempts=maxRetries`; run a cycle; observe it remains leased.
- **Fix:** in the same transaction as every terminal/retry transition, decrement the reservation with a floor of zero. Add startup/cycle reconciliation for expired exhausted leases. Define whether the daily cap is based on actual + active reservation, not cumulative historical reservations. Add state-machine tests with concurrent workers.

## P1 — False-positive readiness

- **Type:** confirmed defect; **priority:** High; **effort:** 1–2 days; **pre-production:** yes.
- **Evidence:** `app/api/health/route.ts:4-5` runs only `SELECT 1`; compose has health checks for PostgreSQL/web only (`docker-compose.prod.yml:22,33`); sync and AI workers have none.
- **Impact:** GitHub Actions reports successful production verification while core background functionality is stalled.
- **Reproduction:** production returned HTTP 200 `{ok:true}` while 70 jobs were stuck and 499 paused.
- **Fix:** separate liveness/readiness; readiness should reject stale worker heartbeats, excessive queue age, failed migration state, stale last sync, and low disk. Deployment should verify the exact commit plus readiness and worker health.

## P1 — Shared Basic Auth cannot enforce least privilege

- **Type:** confirmed security weakness; **priority:** High; **effort:** 3–5 days; **pre-production:** yes for expanded users.
- **Evidence:** `proxy.ts:6-15` validates one username/password for every protected request. There is no user or session model.
- **Impact:** all credential holders have equal access to all client/task/debug data; no individual revocation or attribution; copied credentials provide persistent access.
- **Reproduction:** any valid credential can open normal, debug, API, and server-action routes.
- **Fix:** use an OIDC provider with MFA, secure sessions, named users, role checks, action audit logging, rate limiting, and an emergency revoke procedure. Keep Basic Auth only as a temporary additional perimeter if desired.

## P1 — Missing high-value indexes

- **Type:** confirmed performance risk; **priority:** High; **effort:** 1–2 days; **pre-production:** yes.
- **Evidence:** production `pg_indexes` showed only PK/unique indexes for `Task`, `Comment`, `TaskIntelligence`, and `Client`. Pages repeatedly filter/join by `Task.clientId`, `listId`, `deleted`, `clickupUpdatedAt`, `dueDate`; order comments by task/date; and filter intelligence by `needsAmi`, state, and score.
- **Impact:** growing sequential scans, slower SSR, higher RAM/CPU and lock duration.
- **Reproduction:** inspect `pg_indexes`; then capture query plans for dashboard, review, client details, and worker candidate queries.
- **Fix:** validate and add indexes such as `Task(clientId, deleted, clickupUpdatedAt DESC)`, `Task(listId)`, `Comment(taskId, clickupCreatedAt)`, and targeted intelligence indexes. Use measured plans and avoid speculative excess.

## P1 — Four high-severity dependency advisories

- **Type:** confirmed supply-chain risk; **priority:** High; **effort:** 0.5–1 day; **pre-production:** yes or documented acceptance.
- **Evidence:** `npm audit --omit=dev --json` reported four high vulnerabilities: Prisma/config, `deepmerge-ts` recursive-object stack exhaustion, and `effect` concurrent context contamination. No critical advisories.
- **Impact:** uncertain runtime exposure; the affected Prisma tooling is copied into the runtime image, increasing attack surface.
- **Reproduction:** `npm.cmd audit --omit=dev`.
- **Fix:** test a patched supported Prisma line, remove CLI/dev dependencies from runtime, pin versions, add dependency review. Do not blindly run `audit fix --force`.

## P1 — Incomplete intelligence presented beside operational metrics

- **Type:** confirmed data-quality risk; **priority:** High; **effort:** 1–3 days; **pre-production:** yes.
- **Evidence:** production has 16,509 active tasks but 1,368 intelligence rows (8.3%). Dashboard does disclose “analyzed/imported” in places, but top-line Needs Ami and risk summaries can still be interpreted as comprehensive.
- **Impact:** false negatives: important work may be absent rather than safe.
- **Reproduction:** compare active task and intelligence counts; observe top-level decision count.
- **Fix:** show global coverage/freshness next to every intelligence-derived total, warn when below threshold, and suppress “all caught up” language when coverage or sync freshness is insufficient.

## P2 — Sync overlap recorded as failure noise

- **Type:** confirmed reliability/observability defect; **priority:** Medium; **effort:** 0.5–1 day; **pre-production:** recommended.
- **Evidence:** 236 failed sync runs; the ten newest all say `Client sync already running`. The scheduler creates a run before advisory-lock acquisition (`auto-refresh-clients.ts:17-24`).
- **Impact:** real failures are obscured, alerting becomes noisy, and operators cannot distinguish harmless contention from data loss.
- **Reproduction:** overlap two refreshes for the same client; inspect `SyncRun`.
- **Fix:** represent lock contention as `SKIPPED_LOCKED`/metric, not `FAILED`, or acquire before creating a run. Alert on age/failure rate, not raw historical count.

## P2 — Oversized SSR/debug responses

- **Type:** confirmed performance issue; **priority:** Medium; **effort:** 2–4 days; **pre-production:** no, but fix soon.
- **Evidence:** authenticated live smoke test: `/review` 2.87 s and 1,167,395 bytes; `/debug/voth` 980,587 bytes; `/debug/voth/intelligence` 1,306,464 bytes. This is a single-user, server-local request, not a load test.
- **Impact:** slow rendering, memory churn, poor mobile use, and larger disclosure if a credential leaks.
- **Reproduction:** authenticated `curl` from the web container and record time/size.
- **Fix:** server-side pagination, selective fields, response caps, remove or admin-gate production debug routes, and establish budgets.

## P2 — Host memory ceilings leave no OS allowance

- **Type:** confirmed capacity risk; **priority:** Medium; **effort:** 0.5 day; **pre-production:** monitor immediately.
- **Evidence:** container limits total 2,048 MB on a 1,906 MB RAM host. At observation, 1,212 MB was used and 207 MB swap was already used. Web alone used about 335 MB.
- **Impact:** simultaneous build/restart/worker peaks may swap heavily or cause OOM termination.
- **Fix:** build images off-host/once, share the same image among app services, right-size measured limits, alert on memory/swap, and upgrade only when measurements justify it.

## P2 — Deployment cannot automatically roll back

- **Type:** confirmed reliability gap; **priority:** Medium; **effort:** 1–2 days; **pre-production:** recommended.
- **Evidence:** workflow extracts over the live directory and rebuilds in place; backup covers PostgreSQL only; the prior image/release is not tagged or retained. Health verifies only database connectivity.
- **Impact:** application or migration regressions require manual recovery; extraction can leave files removed from the new release still present on disk.
- **Fix:** immutable versioned releases/images, atomic switch, retain previous image, migration compatibility policy, richer smoke tests, and a tested rollback runbook.

## Additional risks

- Runtime container runs as root and includes the build-time `node_modules`, Prisma CLI, TypeScript, `tsx`, scripts, and source. Use a non-root user and production-only/standalone image.
- Floating `latest` dependencies make builds nondeterministic when lockfiles are regenerated. Pin intentional versions and use controlled updates.
- Backup is local-only with seven-day retention. No evidence of encryption off-host, automated restore verification, or recovery objectives.
- Basic credential comparison is ordinary string equality. Rate limiting at Caddy/application level is absent.
- Webhook raw bodies have no explicit request-size cap; the route stores the full payload.
- Public health reveals service/database state. This is low sensitivity but should return minimal data and be rate-limited.
- The ten-task ClickUp sample had two timestamp mismatches. Names/statuses matched; this is consistent with sync lag, but freshness SLOs and UI timestamps are needed.
- Initial import, destructive/deletion handling, invalid-token recovery, concurrent-worker chaos, decision actions, and mark-read behavior were not changed/tested live because that would write production data.
