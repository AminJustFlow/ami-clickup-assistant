import { prisma } from '@/lib/db/prisma';
import { assessAiReadiness } from '@/lib/intelligence/worker-state';

export async function GET() {
  try {
    const now = new Date();
    const heartbeatMaxAgeMs = Number(process.env.AI_HEALTH_HEARTBEAT_MAX_SECONDS || '300') * 1000;
    const queueMaxAgeMs = Number(process.env.AI_HEALTH_QUEUE_MAX_HOURS || '24') * 3_600_000;
    const [heartbeat, staleLeaseCount, oldestEligible] = await Promise.all([
      prisma.workerHeartbeat.findUnique({ where: { name: 'ai-worker' }, select: { status: true, lastSeenAt: true, lastSuccessAt: true } }),
      prisma.analysisJob.count({ where: { status: 'LEASED', leaseExpiresAt: { lt: now } } }),
      prisma.analysisJob.findFirst({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } })
    ]);
    const ai = assessAiReadiness({ now, heartbeat, staleLeaseCount, oldestEligibleAt: oldestEligible?.nextAttemptAt ?? null, heartbeatMaxAgeMs, queueMaxAgeMs });
    return Response.json({
      ok: ai.ready,
      service: 'ami-clickup-assistant',
      database: 'ok',
      ai: { ready: ai.ready, reasons: ai.reasons }
    }, { status: ai.ready ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, service: 'ami-clickup-assistant', database: 'unavailable' }, { status: 503 });
  }
}
