import { prisma } from '@/lib/db/prisma';
import { operationalReadiness } from '@/lib/operations/readiness';

export async function GET(request: Request) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if (new URL(request.url).searchParams.get('mode') === 'liveness') {
      return Response.json({ ok: true, service: 'ami-clickup-assistant', database: 'ok' });
    }
    const readiness = await operationalReadiness();
    return Response.json({
      ok: readiness.ready,
      service: 'ami-clickup-assistant',
      database: 'ok',
      sync: { ready: readiness.syncReady, oldestClientSyncAt: readiness.oldestSyncAt },
      ai: { ready: readiness.aiReady },
      coverage: { operational: readiness.operationalCoveragePercent, evidence: readiness.evidenceCoveragePercent },
      reasons: readiness.reasons
    }, { status: readiness.ready ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, service: 'ami-clickup-assistant', database: 'unavailable' }, { status: 503 });
  }
}
