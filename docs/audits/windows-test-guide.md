# Windows PowerShell Test Guide

These commands are designed for Windows PowerShell. Run them from the repository root. They do not require Bash or WSL. Commands marked production read-only require authorized access and must not print secrets.

## 1. Preserve local work and identify the source

```powershell
git status --short --branch
git remote -v
git fetch --prune origin
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
git log --oneline --decorate --graph -20 --all
```

Expected audited SHA: `7d84c46135407ef6f4e4b79b4827b5225ae247f4`. If it changes, record the new SHA and treat the audit as a new run. Never use `git reset --hard`, `git clean`, or checkout over a dirty tree.

Create an isolated worktree and branch:

```powershell
$AuditPath = Join-Path $env:TEMP 'ami-clickup-assistant-audit'
git worktree add -b audit/production-readiness $AuditPath origin/main
Set-Location $AuditPath
git status --short --branch
```

If that branch/path already exists, choose a new dated name. Do not delete an existing worktree without checking its contents.

## 2. Install and run safe local checks

Use `npm.cmd`, because PowerShell execution policy may block `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test
npm.cmd audit --omit=dev
```

`npm audit` returning a nonzero exit is expected while a vulnerability exists; save the report without applying an automatic force fix:

```powershell
npm.cmd audit --omit=dev --json | Out-File -Encoding utf8 (Join-Path $env:TEMP 'ami-npm-audit.json')
```

There is currently no lint script. Do not claim lint passed. The new `npm test` script exists only on the audit branch until reviewed and merged.

## 3. Public read-only production checks

```powershell
Resolve-DnsName intelligence.justflownh.com -Type A
curl.exe -sS -o NUL -w "health=%{http_code} tls=%{ssl_verify_result} time=%{time_total}`n" https://intelligence.justflownh.com/api/health
curl.exe -sS https://intelligence.justflownh.com/api/health
curl.exe -sS -o NUL -w "root=%{http_code}`n" https://intelligence.justflownh.com/
curl.exe -sSI https://intelligence.justflownh.com/api/health
```

Expected: DNS `34.224.54.213`, health 200, TLS verify 0, unauthenticated root 401. Do not put the Basic Auth password on a shared command line, in shell history, screenshots, or reports.

## 4. Authorized production host checks (read-only)

Set the key path without displaying its contents:

```powershell
$SshKey = Join-Path $env:TEMP 'ami-lightsail-default.pem'
Test-Path -LiteralPath $SshKey
ssh.exe -i $SshKey -o StrictHostKeyChecking=yes ubuntu@34.224.54.213 'cat /opt/ami-clickup-assistant/.deployed-commit'
ssh.exe -i $SshKey -o StrictHostKeyChecking=yes ubuntu@34.224.54.213 'cd /opt/ami-clickup-assistant && sudo docker compose -f docker-compose.prod.yml ps'
ssh.exe -i $SshKey -o StrictHostKeyChecking=yes ubuntu@34.224.54.213 'uptime; free -m; df -h / /var/lib/docker; sudo docker stats --no-stream'
```

For database verification, run only `SELECT` statements. The following pattern reads credentials inside the container so they are not exposed locally:

```powershell
$Sql = 'SELECT status, count(*), min("nextAttemptAt"), max("updatedAt") FROM "AnalysisJob" GROUP BY status ORDER BY status;'
$SqlBytes = [Text.Encoding]::UTF8.GetBytes($Sql)
$Sql64 = [Convert]::ToBase64String($SqlBytes)
$Remote = "echo $Sql64 | base64 -d | sudo docker exec -i ami-clickup-assistant-postgres-1 sh -lc 'psql -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -At -F `"|`"'"
ssh.exe -i $SshKey -o StrictHostKeyChecking=yes ubuntu@34.224.54.213 $Remote
```

Useful read-only queries:

```sql
SELECT status, count(*), min("nextAttemptAt"), max("updatedAt")
FROM "AnalysisJob" GROUP BY status ORDER BY status;

SELECT name, status, "lastSeenAt", "lastSuccessAt", "lastError"
FROM "WorkerHeartbeat" ORDER BY name;

SELECT status, count(*), max("completedAt")
FROM "SyncRun" GROUP BY status ORDER BY status;

SELECT day, "actualEstimatedUsd", "reservedUsd", "successfulJobs", "failedJobs", "updatedAt"
FROM "AiBudgetDay" ORDER BY day DESC LIMIT 3;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('Task','Comment','TaskIntelligence','Client')
ORDER BY tablename,indexname;
```

Do not run Prisma migrations, workers, sync scripts, analysis commands, `UPDATE`, `DELETE`, `INSERT`, `TRUNCATE`, `DROP`, backups, restores, deployments, or container restarts as part of a read-only audit.

## 5. Safe browser/E2E setup for a future run

The audited repository has no Playwright dependency and no browser suite. Add it only on a feature branch after review:

```powershell
npm.cmd install --save-dev @playwright/test
npx.cmd playwright install chromium
```

Use a local isolated PostgreSQL database populated with synthetic fixtures. Store credentials in an ignored local environment file, never in test source. Configure Playwright `httpCredentials` from environment variables and test these viewports:

```text
1920x1080, 1440x900, 1366x768, 768x1024, 390x844, 375x812
```

Minimum E2E flows: authentication rejection/success; all navigation; Needs Ami filters/pagination/decision lifecycle; Recent Updates filters/group expansion/mark-read; clients/team/search; long content; keyboard focus; axe/contrast; console/page errors; screenshots only on failure. Mutation tests must point to the isolated fixture database, never production.

## 6. Cleanup after review

First confirm the audit branch has no work that must be kept:

```powershell
git status --short
git diff --stat
```

Do not remove the worktree or branch until the reports/tests have been copied, committed, or explicitly discarded by the owner. No cleanup command is included intentionally.
