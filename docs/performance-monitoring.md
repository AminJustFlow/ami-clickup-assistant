# Phase 24: Performance and reliability checks

This is an **operator-only** runbook. It does not add work or notifications for Ami, consume AI credits, or change ClickUp data.

## Route latency (already logged by Caddy)

The existing Caddy JSON access logs contain `duration` (seconds), `status`, and the request URI. Run on the AWS host:

```sh
cd /opt/ami-clickup-assistant
docker compose -f docker-compose.prod.yml logs --since=30m --no-log-prefix caddy | grep '"duration"' | tail -30
```

Use logs for representative real requests to `/`, `/attention`, `/clients`, and `/search`. Avoid pasting full access logs publicly: URIs can contain search terms and log records may contain request metadata. Measure p50/p95 over comparable periods and avoid treating a single slow request as a trend. Caddy durations include upstream handling and proxy overhead; they are not browser rendering times.

## Resource pressure

```sh
docker stats --no-stream
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --since=1h web | tail -50
```

Look for web container memory close to its limit, unexpected restarts, and 502/503 responses. These are read-only commands. Do not increase memory limits or restart services without checking available host RAM and a rollback plan.

## Optional database diagnostics

Slow-query logging is **off by default**. To opt in, set `SLOW_QUERY_MS=500` in the production web environment and redeploy during a maintenance window. It emits a short JSON warning only when a Prisma query exceeds the threshold. Logs include duration and Node process memory but never SQL, SQL parameters, client names, or task contents. Enabling Prisma query events can add instrumentation overhead, so disable the setting after investigation.

```sh
docker compose -f docker-compose.prod.yml logs --since=30m web 2>&1 | grep '\[performance\]'
```

For deeper investigation, use PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` on a **sanitized, read-only SELECT** in a non-production environment first. `EXPLAIN ANALYZE` executes the statement; never run it against modifying SQL.

## Validation

After deploy, compare response time and memory observations to a pre-deploy baseline under similar traffic. Check `/api/health` and all core routes. If there are regressions, revert the PR; the optional logger is disabled unless explicitly configured.
