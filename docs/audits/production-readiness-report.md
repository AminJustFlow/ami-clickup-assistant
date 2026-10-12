# Ami ClickUp Assistant — Production Readiness Audit

Audit date: 2026-10-12 (America/New_York)  
Audited source: `origin/main` at `7d84c46135407ef6f4e4b79b4827b5225ae247f4`  
Production URL: `https://intelligence.justflownh.com`  
Recommendation: **NO-GO for dependable unattended daily operation**; the read-only dashboard may continue to be used with explicit awareness that AI coverage is incomplete and can become stale.

## Executive summary

The deployed application is reachable over valid HTTPS, requires authentication for application pages, builds successfully, and is running the same commit as current `origin/main`. All tested GET pages returned HTTP 200. Core grouping, dependency evidence, context extraction, attention lifecycle, and change-detection tests pass. The ten most recently updated ClickUp tasks showed exact name/status/timestamp agreement for eight records; two had newer ClickUp timestamps than the local record, consistent with ordinary sync lag but still important to surface.

It is not yet reliable enough to treat as an authoritative daily decision system. The production AI queue has 70 jobs stranded in `LEASED` since October 9 and 499 jobs paused for budget. Only 1,368 of 16,509 active tasks have intelligence (8.3%). The worker increments reserved daily budget on every lease but never releases the reservation after success or failure. Jobs that expire after reaching the attempt limit remain `LEASED` forever. The public health endpoint checks only `SELECT 1`, so it reports healthy despite those failures. Database indexes are absent on the principal task/comment/intelligence query paths. Production dependencies include four high-severity advisories. Authentication is one shared Basic Auth credential, which provides no per-user authorization, revocation, or accountability.

## Score: 57/100

| Criterion | Weight | Score | Rationale |
|---|---:|---:|---|
| Functional correctness | 20 | 15 | All read-only pages load and core deterministic logic passes; mutation workflows were not executed against production. |
| Data accuracy / AI quality | 20 | 8 | 8/10 sampled records matched exactly, but intelligence coverage is 8.3% and the queue is stalled. |
| Security | 15 | 8 | TLS, HMAC webhook validation, network isolation, and secret exclusion are sound; shared Basic Auth and high advisories remain. |
| Reliability / operations | 20 | 9 | Containers are up and deployed SHA is verifiable; health checks miss worker failure, no automatic rollback, and queue accounting is broken. |
| Performance / scalability | 10 | 5 | Current host has headroom, but critical indexes are missing and several pages return 1 MB+ SSR responses. |
| Test / maintainability | 10 | 7 | Build and four deterministic suites pass; no lint, isolated DB integration, browser E2E, or CI test step existed. |
| UX / accessibility | 5 | 5 | Responsive CSS and semantic labels exist; automated viewport/keyboard/contrast validation was blocked by unavailable browser automation. |
| **Total** | **100** | **57** | |

## Test totals

The detailed matrix contains **52 tests: 34 passed, 9 failed, 6 blocked, and 3 not tested**. “Blocked” means the requested verification required a data-changing production action, unavailable browser automation, or an isolated database fixture that does not exist. No result was inferred from a successful build alone.

## Critical issues requiring immediate attention

1. **AI queue and budget accounting are broken (Critical).** `reservedUsd` only increments; it is never decremented when a job completes or fails. Expired leases with `attempts >= maxRetries` are not selected or terminalized. Production evidence: 70 stale leased jobs, 499 paused jobs, and only 1,368/16,509 active tasks analyzed.
2. **Health checks can report false readiness (High).** `/api/health` validates only database connectivity. It returned 200 while the AI queue was stuck and workers have no container health checks.
3. **Shared Basic Auth is inadequate for internal client data (High).** There is one credential, no individual identity, no roles, no audit trail, and no selective revocation.
4. **High-severity dependency advisories (High).** `npm audit --omit=dev` reported four high vulnerabilities in the Prisma CLI/config dependency chain. Runtime exploitability appears limited because the affected path is primarily tooling, but it must be resolved or formally risk-accepted.
5. **Missing database indexes (High).** Production confirms only primary/unique indexes on `Task`, `Comment`, `TaskIntelligence`, and `Client`, despite frequent filters and joins by client, list, deletion state, update time, comment task/date, and intelligence flags.

## Production observations

- DNS resolves to `34.224.54.213`; TLS verification succeeded; HSTS, `nosniff`, and same-origin referrer policy are present.
- Production `.deployed-commit` exactly matches audited `origin/main`.
- PostgreSQL and web containers are healthy; all five services are running with zero container restarts. Workers have no Docker health check.
- Host at observation: 1,906 MB RAM, 693 MB available, 207 MB swap used, disk 29% used. Configured container memory ceilings total 2,048 MB, leaving no allowance for Docker/OS overhead.
- Production data: 16,509 active tasks, 30,625 comments, 87 active clients, 1,368 intelligence rows, 35 open Needs Ami items, 70 pending/leased jobs, and one unprocessed event.
- All fourteen authenticated GET routes tested returned 200. `/review` took 2.87 s and returned 1.17 MB; debug intelligence returned 1.31 MB. These are warning signs rather than representative load-test results.
- The sync worker is current, but 236 historical sync runs are failed. The ten newest failures all reported overlapping advisory locks (“Client sync already running”), which creates noisy failure reporting and reduces observability.

## Architecture assessment

The application is a compact Next.js App Router monolith with server-rendered pages, Prisma/PostgreSQL storage, polling sync and AI worker processes, Caddy TLS termination, and GitHub Actions SSH deployment. This is reasonable for the present scale. Strong choices include HMAC/timing-safe webhook validation, idempotency keys, PostgreSQL advisory locks, serializable intelligence writes, bounded worker discovery, deployment locking, pre-deploy backup, migration-before-up, pinned SSH host key, deployed-commit verification, and non-public PostgreSQL.

Weaknesses include very large page-level queries followed by in-memory filtering, repeated client-group aggregation, extensive raw JSON storage and rendering, no structured application telemetry, no user model, no readiness contract, no rollback automation, no restore test, and a runtime image containing the full development dependency tree and running as root. Several debug routes are shipped to production and can render large amounts of internal information to anyone holding the shared credential.

## Top 10 improvements

1. Correct reservation release and terminalize exhausted/expired AI leases; add transactional regression tests. **Critical, 1–2 days, pre-rollout.**
2. Reconcile the current production queue with a reviewed one-time migration/runbook after deploying the fix. **Critical, 0.5 day, pre-rollout.**
3. Make readiness include worker heartbeat age, stale leases, queue depth, last successful sync, migration state, and disk thresholds. **High, 1–2 days, pre-rollout.**
4. Replace shared Basic Auth with an identity provider, per-user sessions, authorization, and audit events. **High, 3–5 days, pre-rollout for broad use.**
5. Add production indexes based on `EXPLAIN (ANALYZE, BUFFERS)` and deploy them concurrently where supported. **High, 1–2 days, pre-rollout.**
6. Pin dependency versions and resolve/accept the four advisories; prevent floating `latest` upgrades. **High, 0.5–1 day.**
7. Add an isolated PostgreSQL integration-test job and Playwright E2E for filters, pagination, decisions, mark-read, search, and responsive layouts. **High, 3–5 days.**
8. Paginate/filter in SQL and cap/debug-protect large payload pages; target <500 ms server response and <250 KB initial HTML. **Medium, 2–4 days.**
9. Add worker Docker health checks, alerts, Sentry/OpenTelemetry, backup upload, restore drills, and a documented rollback command. **High, 2–4 days.**
10. Add confidence/evidence/last-synced indicators in the UI and explicitly distinguish incomplete AI coverage from zero risk. **High, 1–3 days.**

## Decision and next steps

1. Freeze claims that the dashboard is comprehensive; it currently analyzes 8.3% of active tasks.
2. Fix and test the AI lease/budget state machine on this audit branch or a dedicated repair branch.
3. Review and execute a production queue-reconciliation plan only after backup and approval.
4. Add readiness checks and alerts, then perform a controlled failure test.
5. Add indexes after query-plan measurement.
6. Resolve authentication and dependency risks.
7. Run isolated DB integration and browser E2E suites, including all mutation workflows.
8. Perform a backup restoration drill and rollback exercise.
9. Re-audit the critical/high items and reconsider a **CONDITIONAL GO** only after the queue drains normally and readiness catches induced failures.

No production data, deployment, infrastructure, secrets, or remote files were modified during this audit.
