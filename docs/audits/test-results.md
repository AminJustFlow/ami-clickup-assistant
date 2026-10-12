# Test Results

## Summary

| Result | Count |
|---|---:|
| PASS | 34 |
| FAIL | 9 |
| BLOCKED | 6 |
| NOT TESTED | 3 |
| **Total** | **52** |

Commands were executed on Windows PowerShell in an isolated worktree from `origin/main`. Production checks were read-only. Response bodies containing internal work data and all secrets were deliberately omitted.

## Test matrix

| # | Test case | Expected | Actual / evidence | Result |
|---:|---|---|---|---|
| 1 | Remote main freshness | Audit latest remote main | Fetch showed `origin/main` at `7d84c46135407ef6f4e4b79b4827b5225ae247f4`; feature branch was nine commits behind | PASS |
| 2 | Preserve local work | No reset/clean/overwrite | Dirty original tree recorded; isolated audit worktree/branch used | PASS |
| 3 | Locked install | `npm ci` succeeds | 70 packages installed | PASS |
| 4 | Lock integrity | Install uses lock without mutation failure | `npm ci` completed; lock resolved | PASS |
| 5 | Prisma generation | Client generates | Prisma 6.19.0 generation succeeded | PASS |
| 6 | TypeScript | No type errors | `tsc --noEmit` exit 0 | PASS |
| 7 | Production build | All routes compile | Next 16.4.0 build exit 0; 17 routes enumerated | PASS |
| 8 | Client grouping tests | Verified/ambiguous folders handled | Existing suite passed | PASS |
| 9 | Dependency-evidence tests | Exact IDs/cross-list/dedup behavior | Existing suite passed | PASS |
| 10 | Context-quality tests | Empty omitted; zero/false retained | Existing suite passed | PASS |
| 11 | Core regression tests | Attention/disposition/change chronology correct | New isolated `app:test-core` suite passed | PASS |
| 12 | DNS | Domain maps to static IP | Resolved `34.224.54.213` | PASS |
| 13 | HTTPS | Valid TLS and security headers | TLS verify code 0; HSTS, nosniff, referrer policy present | PASS |
| 14 | Unauthenticated root | Reject access | HTTP 401 | PASS |
| 15 | Public liveness endpoint | Responds when DB reachable | HTTP 200 in 0.116 s, database `ok` | PASS |
| 16 | Deployed commit | Live SHA equals audited SHA | Exact match `7d84c46…` | PASS |
| 17 | Compose services | Five services running | PostgreSQL, web, sync, AI, Caddy up; zero restarts | PASS |
| 18 | Database container | DB healthy | Docker health `healthy`, `SELECT` queries succeeded | PASS |
| 19 | Worker heartbeat recency | Workers reporting recently | AI and sync `IDLE` with current `lastSeenAt` at observation | PASS |
| 20 | Disk/capacity snapshot | No immediate disk exhaustion | Root disk 29% used; 41 GB available | PASS |
| 21 | Production dependency audit | No high/critical advisory | Four high advisories | FAIL |
| 22 | Lint | Configured lint succeeds | No lint script/configuration exists | NOT TESTED |
| 23 | Existing browser/E2E suite | E2E suite available | None exists | NOT TESTED |
| 24 | DB integration suite | Writes isolated from production | No isolated PostgreSQL fixture/test database supplied | BLOCKED |
| 25 | Dashboard GET | Authenticated 200 | 200, 1.776 s, 55,494 bytes | PASS |
| 26 | Needs Ami GET | Authenticated 200 | 200, 0.106 s, 74,083 bytes | PASS |
| 27 | Recent Updates GET | Authenticated 200 | 200, 0.357 s, 54,778 bytes | PASS |
| 28 | Clients GET | Authenticated 200 | 200, 0.040 s, 50,153 bytes | PASS |
| 29 | Client detail GET | Representative valid slug loads | 200, 0.461 s, 125,298 bytes | PASS |
| 30 | Team GET | Authenticated 200 | 200, 0.136 s, 19,809 bytes | PASS |
| 31 | Employee detail GET | Representative valid ID loads | 200, 0.363 s, 84,039 bytes | PASS |
| 32 | Search GET | Empty query handled | 200, 0.021 s, 11,146 bytes | PASS |
| 33 | System GET | Authenticated 200 | 200, 0.023 s, 14,454 bytes | PASS |
| 34 | Review GET | Authenticated response produced | HTTP 200 (performance separately failed) | PASS |
| 35 | Task details API GET | Valid task returns response | 200, 0.185 s, 858 bytes | PASS |
| 36 | Debug tasks GET | Protected route loads | 200, 0.465 s | PASS |
| 37 | Debug VOTH GET | Protected route loads | 200, 0.985 s | PASS |
| 38 | Debug VOTH intelligence GET | Protected route loads | 200, 0.781 s | PASS |
| 39 | ClickUp representative consistency | Local core fields match live ClickUp | 8/10 exact; two differed on `updatedAt`; name/status matched | FAIL |
| 40 | Initial import, archive/deletion lifecycle | Verify full write lifecycle | Would change database state; no isolated DB/API fixture | BLOCKED |
| 41 | Decision, dismiss/resolve, mark-read actions | Verify writes and stale fingerprints | Would change production data; not executed | BLOCKED |
| 42 | Invalid token, 429/5xx, downtime, simultaneous-worker fault injection | Retries and recovery proven | Requires controlled mocks/isolated infrastructure | BLOCKED |
| 43 | Representative AI quality labeling | Human-reviewed false positive/negative rates | Needs an approved labeled task set and reviewer; not inferred | BLOCKED |
| 44 | Six viewport, keyboard, contrast, console and screenshots | Automated browser evidence | Computer-use browser unavailable; no Playwright browser installed | BLOCKED |
| 45 | Expired AI leases | Expired/exhausted jobs terminalize | 70 jobs remained `LEASED` since Oct 9 | FAIL |
| 46 | AI reservation accounting | Reservation released on completion/failure | Code never decrements; current row reserved $1.996800 vs actual $0.238709 | FAIL |
| 47 | Readiness detects worker failure | Health reflects real application readiness | Health 200 while queue stalled | FAIL |
| 48 | Query indexes | High-volume filters/joins indexed | Only PK/unique indexes on core task/comment/intelligence tables | FAIL |
| 49 | Page response budget | Key pages reasonably bounded | `/review` 2.87 s / 1.17 MB; debug intelligence 1.31 MB | FAIL |
| 50 | Sync failure signal | Contention not treated as failure | 236 failures; newest ten were advisory-lock contention | FAIL |
| 51 | Host memory safety margin | Limits leave OS/Docker headroom | Limits total 2,048 MB on 1,906 MB host; 207 MB swap used | FAIL |
| 52 | Backup restore and rollback drill | Restore/RTO/RPO proven | Destructive/production-changing; no isolated restore target | NOT TESTED |

## Coverage notes

- The route smoke timings are single observations executed inside the production web container. They are useful for finding outliers, not substitutes for load tests.
- The ClickUp sample used authorized read-only API calls against the ten most recently updated local tasks. It compared task name, status, and ClickUp update timestamp; it did not mutate ClickUp.
- Code review verified safeguards such as ClickUp retry/backoff, full-task enrichment, comment cursor repetition detection, idempotent upserts, webhook HMAC validation, event keys, advisory locks, and serializable intelligence writes. Those mechanisms were not counted as executed integration passes unless a test actually exercised them.
- Browser testing was attempted through the approved computer-use tooling, but no Chrome or Edge surface was available. No screenshots are claimed.

## Added test infrastructure

On branch `audit/production-readiness-2026-10-12` only:

- Added `npm test`, chaining all four deterministic suites.
- Added `scripts/test-core-behavior.ts` covering closed statuses, Needs Ami disposition fingerprint behavior, reopened recommendations after source changes, observed status/assignee changes, and comment chronology.
- The changes are uncommitted, unpushed, undeployed, and do not touch production.
