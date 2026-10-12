#!/usr/bin/env bash
set -euo pipefail

cd /opt/ami-clickup-assistant
compose=(sudo docker compose -f docker-compose.prod.yml)
postgres_id="$("${compose[@]}" ps -q postgres)"
test -n "$postgres_id" || { echo 'PostgreSQL container not found'; exit 1; }

sql() {
  printf '%s\n' "$1" | sudo docker exec -i "$postgres_id" sh -lc 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|"'
}

echo 'PREFLIGHT_UTC'
date -u +%Y-%m-%dT%H:%M:%SZ
echo 'DEPLOYED_COMMIT'
cat .deployed-commit 2>/dev/null || echo 'missing'
echo 'COMPOSE_STATE'
"${compose[@]}" ps
echo 'AI_RESTART_POLICY'
ai_id="$("${compose[@]}" ps -a -q ai-worker)"
if [[ -n "$ai_id" ]]; then sudo docker inspect -f 'status={{.State.Status}} running={{.State.Running}} restart={{.HostConfig.RestartPolicy.Name}} restarts={{.RestartCount}}' "$ai_id"; else echo 'ai-worker container missing'; fi
echo 'JOB_STATUS'
sql 'SELECT status, count(*), min("nextAttemptAt"), max("updatedAt") FROM "AnalysisJob" GROUP BY status ORDER BY status;'
echo 'LEASE_ATTEMPTS'
sql 'SELECT attempts, count(*), min("leaseExpiresAt"), max("leaseExpiresAt"), count(*) FILTER (WHERE "leaseExpiresAt" >= (CURRENT_TIMESTAMP AT TIME ZONE '\''UTC'\'')) AS unexpired FROM "AnalysisJob" WHERE status='\''LEASED'\'' GROUP BY attempts ORDER BY attempts;'
echo 'BUDGET_LAST_7_DAYS'
sql 'SELECT day, "reservedUsd", "actualEstimatedUsd", "reservedUsd" + "actualEstimatedUsd" AS committed, "successfulJobs", "failedJobs", "updatedAt" FROM "AiBudgetDay" ORDER BY day DESC LIMIT 7;'
echo 'WORKER_HEARTBEAT'
sql 'SELECT name, status, "lastSeenAt", EXTRACT(EPOCH FROM ((CURRENT_TIMESTAMP AT TIME ZONE '\''UTC'\'') - "lastSeenAt"))::bigint AS heartbeat_age_seconds, "lastSuccessAt", LEFT(COALESCE("lastError",'\'''\''),160) FROM "WorkerHeartbeat" ORDER BY name;'
echo 'COVERAGE'
sql 'SELECT count(*) FILTER (WHERE NOT t.deleted) AS active_tasks, count(*) FILTER (WHERE NOT t.deleted AND i.id IS NOT NULL) AS analyzed_tasks FROM "Task" t LEFT JOIN "TaskIntelligence" i ON i."taskId"=t.id;'
echo 'MIGRATIONS'
sql 'SELECT migration_name, COALESCE(finished_at::text,'\''unfinished'\''), COALESCE(rolled_back_at::text,'\'''\'') FROM "_prisma_migrations" ORDER BY started_at;'
echo 'RECOVERY_MARKER'
if [[ -f .ai-pipeline-recovery-complete ]]; then cat .ai-pipeline-recovery-complete; else echo 'not-complete'; fi
