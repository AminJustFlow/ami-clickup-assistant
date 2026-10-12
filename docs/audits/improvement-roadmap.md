# Improvement Roadmap

## Immediate: before relying on daily intelligence (0–7 days)

| Priority | Work | Evidence / impact | Effort | Pre-rollout |
|---|---|---|---:|---|
| Critical | Repair AI reservation and lease state machine | 70 stale leased, 499 paused; reservations never released | 1–2 days | Yes |
| Critical | Reconcile existing queue with a reviewed runbook | Current jobs will not self-heal solely from normal selection | 0.5 day | Yes |
| High | Add transaction-level worker tests with isolated PostgreSQL | Current tests cannot prove leases, concurrent reservations, retry transitions | 1–2 days | Yes |
| High | Replace shallow readiness with worker/queue/sync/migration checks | Current health passed during queue failure | 1–2 days | Yes |
| High | Add measured core-table indexes | Current production lacks indexes for common filters/joins | 1–2 days | Yes |
| High | Resolve or formally accept dependency advisories; slim runtime image | Four high findings; tooling copied to runtime | 0.5–1 day | Yes |
| High | Display coverage/freshness beside every AI-derived count | Only 8.3% of active tasks analyzed | 1 day | Yes |

Acceptance criteria: no stale lease beyond lease TTL + two cycles; `reservedUsd` equals active reservations; paused work resumes next budget day; health turns non-ready during simulated worker staleness; queue drains under a fixed cost cap; query plans use intended indexes; UI never says “caught up” without adequate coverage.

## Short term: dependable operations (1–4 weeks)

| Priority | Work | Practical outcome | Effort |
|---|---|---|---:|
| High | OIDC/MFA, individual accounts, authorization, action audit | Protect internal client information and establish accountability | 3–5 days |
| High | Playwright E2E at 1920, 1440, 1366, 768, 390 and 375 px | Verify navigation, filters, pagination, long content, keyboard, console | 3–5 days |
| High | Isolated ClickUp mock + PostgreSQL integration suite | Safely prove initial/incremental sync, deletion, comments, retries, concurrency | 4–7 days |
| High | Monitoring and alerting | Alert on stale heartbeat, queue age, sync freshness, 5xx, disk, swap, backup age | 2–3 days |
| High | Off-host encrypted backups and automated restore test | Demonstrate recovery rather than assuming dumps are valid | 2–3 days |
| Medium | Immutable build-once deployment and rollback | Faster deploys; same image for web/workers; retain previous release | 2–4 days |
| Medium | SQL pagination and response budgets | Reduce `/review` and debug payloads; lower memory/latency | 2–4 days |
| Medium | Reclassify sync lock contention as skipped | Make operational failure counts actionable | 0.5–1 day |
| Medium | Remove/admin-gate production debug routes | Reduce data exposure and accidental large queries | 0.5–1 day |
| Medium | Pin versions and automate controlled upgrades | Reproducible builds; avoid floating `latest` | 0.5 day |

Recommended service-level objectives: sync freshness <30 minutes for 99% of active clients; AI queue oldest eligible item <24 hours subject to declared budget; authenticated page p95 server response <750 ms; deployment readiness verification <5 minutes; backup recovery point ≤24 hours and tested recovery time ≤2 hours.

## Future: accuracy and daily usability (1–3 months)

- Create a small, versioned, human-labeled evaluation set covering approval, teammate/client/vendor waits, overdue/completed, maintenance, conflicting/outdated/no-action tasks. Track precision/recall for Needs Ami and responsibility attribution before prompt/model changes.
- Show evidence citations, source comment time, analysis time, ClickUp sync time, confidence, and “why this needs Ami” directly in task details.
- Add user feedback (“correct”, “not mine”, “already resolved”) that becomes evaluation data; do not automatically train on unreviewed feedback.
- Separate observed ClickUp facts from AI inference visually and in storage. Retain prompt/model/fingerprint lineage.
- Add a small operations page for worker freshness, backlog age, daily actual/reserved spend, last successful sync, and data coverage.
- Precompute or cache aggregate dashboard metrics after sync rather than loading broad task/comment graphs on every request.
- Add per-client freshness/coverage thresholds and prioritize analysis by operational value, not just recent update time.
- Review data retention for raw ClickUp payloads, webhook events, comments, logs, and backups; document deletion and access policy.

## Suggested implementation order

1. Write failing state-machine integration tests.
2. Fix reservation release, expired lease terminalization, and queue reconciliation logic.
3. Add readiness/alerts and perform controlled failure verification.
4. Measure query plans and add indexes.
5. Reconcile production only with explicit approval, backup, and rollback steps.
6. Add identity/access control and dependency/runtime hardening.
7. Add E2E plus full sync fault tests.
8. Optimize pages and deployment/restore architecture.
9. Establish the labeled AI-quality benchmark and iterate from measured results.
