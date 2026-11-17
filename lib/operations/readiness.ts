import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { assessAiReadiness } from '@/lib/intelligence/worker-state';

const CLOSED = ['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled'];

export function operationalScopeWhere(now = new Date()): Prisma.TaskWhereInput {
  const recent = new Date(now.getTime() - 90 * 86_400_000);
  const relevantDeadline = new Date(now.getTime() - 7 * 86_400_000);
  return {
    deleted: false,
    client: { active: true, space: { name: 'JF Corporate' } },
    AND: [
      { OR: [{ clickupStatus: null }, { NOT: { clickupStatus: { in: CLOSED, mode: 'insensitive' } } }] },
      { OR: [
        { clickupUpdatedAt: { gte: recent } },
        { dueDate: { gte: relevantDeadline } },
        { intelligence: { is: { needsAmi: true } } },
        { intelligence: { is: { agentState: { in: ['BLOCKED', 'ISSUE', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'WAITING_ON_TEAM'] } } } }
      ] }
    ]
  };
}

export async function operationalReadiness(now = new Date()) {
  const syncMaxAgeMs = Number(process.env.SYNC_HEALTH_MAX_SECONDS || '1800') * 1000;
  const heartbeatMaxAgeMs = Number(process.env.AI_HEALTH_HEARTBEAT_MAX_SECONDS || '300') * 1000;
  const queueMaxAgeMs = Number(process.env.AI_HEALTH_QUEUE_MAX_HOURS || '24') * 3_600_000;
  const scope = operationalScopeWhere(now);
  const [clients, aiHeartbeat, syncHeartbeat, staleLeaseCount, oldestEligible, operational, analyzed, unverifiedActions] = await Promise.all([
    prisma.client.aggregate({ where: { active: true, space: { name: 'JF Corporate' } }, _min: { lastSyncedAt: true }, _count: true }),
    prisma.workerHeartbeat.findUnique({ where: { name: 'ai-worker' }, select: { status: true, lastSeenAt: true, lastSuccessAt: true } }),
    prisma.workerHeartbeat.findUnique({ where: { name: 'clickup-sync' }, select: { status: true, lastSeenAt: true, lastSuccessAt: true } }),
    prisma.analysisJob.count({ where: { status: 'LEASED', leaseExpiresAt: { lt: now } } }),
    prisma.analysisJob.findFirst({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } }),
    prisma.task.count({ where: scope }),
    prisma.task.count({ where: { AND: [scope, { intelligence: { is: { classificationVersion: 'TASK_ANALYZER_V14_EVIDENCE' } } }] } }),
    prisma.task.count({ where: { AND: [scope, { intelligence: { is: { needsAmi: true, OR: [{ verificationStatus: null }, { NOT: { verificationStatus: 'VERIFIED' } }] } } }] } })
  ]);
  const ai = assessAiReadiness({ now, heartbeat: aiHeartbeat, staleLeaseCount, oldestEligibleAt: oldestEligible?.nextAttemptAt ?? null, heartbeatMaxAgeMs, queueMaxAgeMs });
  const oldestSyncAt = clients._min.lastSyncedAt;
  const syncHeartbeatCurrent = !!syncHeartbeat && now.getTime() - syncHeartbeat.lastSeenAt.getTime() <= syncMaxAgeMs;
  const syncReady = clients._count > 0 && !!oldestSyncAt && now.getTime() - oldestSyncAt.getTime() <= syncMaxAgeMs && syncHeartbeatCurrent && syncHeartbeat.status !== 'FAILED';
  const coveragePercent = operational ? Math.round(100 * analyzed / operational) : 100;
  const reasons = [
    ...ai.reasons,
    !syncHeartbeat ? 'sync_worker_heartbeat_missing' : null,
    syncHeartbeat?.status === 'FAILED' ? 'sync_worker_failed' : null,
    syncHeartbeat && !syncHeartbeatCurrent ? 'sync_worker_heartbeat_stale' : null,
    !oldestSyncAt ? 'client_sync_missing' : oldestSyncAt && now.getTime() - oldestSyncAt.getTime() > syncMaxAgeMs ? 'client_sync_stale' : null,
    coveragePercent < 95 ? 'operational_analysis_coverage_low' : null,
    unverifiedActions > 0 ? 'unverified_action_candidates_present' : null
  ].filter((reason): reason is string => !!reason);
  return {
    ready: ai.ready && syncReady && coveragePercent >= 95 && unverifiedActions === 0,
    syncReady, aiReady: ai.ready, reasons, oldestSyncAt,
    operationalTasks: operational, analyzedOperationalTasks: analyzed,
    operationalCoveragePercent: coveragePercent,
    evidenceCoveragePercent: operational ? Math.max(0, Math.round(100 * (analyzed - Math.min(analyzed, unverifiedActions)) / operational)) : 100,
    unverifiedActions
  };
}
