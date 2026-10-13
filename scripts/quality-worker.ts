import { loadEnvConfig } from '@next/env';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db/prisma';
import { attentionVerificationReasons, isClosedClickUpStatus } from '../lib/attention/triage';

if (!process.env.DATABASE_URL) loadEnvConfig(process.cwd());
const once = process.argv.includes('--once');
const intervalMs = 15 * 60_000;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

export type QualitySnapshot = {
  inspected: number;
  stale: number;
  closedAttention: number;
  invalidScores: number;
  needsVerification: number;
  repaired: number;
};

// Deliberately use only deterministic, source-backed checks. AI judgment is
// never rewritten by this worker, and no OpenAI or ClickUp requests are made.
export function inspectQuality(task: {
  clickupStatus: string | null;
  clickupUpdatedAt: Date | null;
  intelligence: {
    analyzedAt: Date | null;
    needsAmi: boolean;
    confidence: number | null;
    amiAction: string | null;
    amiAttentionScore: number;
    importanceScore: number;
    sourceFingerprint: string | null;
  };
}): { stale: boolean; closedAttention: boolean; invalidScores: boolean; needsVerification: boolean } {
  const i = task.intelligence;
  const stale = Boolean(task.clickupUpdatedAt && (!i.analyzedAt || task.clickupUpdatedAt.getTime() > i.analyzedAt.getTime() + 120_000));
  const closedAttention = i.needsAmi && isClosedClickUpStatus(task.clickupStatus);
  const invalidScores = !Number.isFinite(i.amiAttentionScore) || !Number.isFinite(i.importanceScore)
    || i.amiAttentionScore < 0 || i.amiAttentionScore > 100
    || i.importanceScore < 0 || i.importanceScore > 100;
  const needsVerification = i.needsAmi && attentionVerificationReasons(task).length > 0;
  return { stale, closedAttention, invalidScores, needsVerification };
}

export async function auditOnce(): Promise<QualitySnapshot> {
  const snapshot: QualitySnapshot = { inspected: 0, stale: 0, closedAttention: 0, invalidScores: 0, needsVerification: 0, repaired: 0 };
  let cursor: number | undefined;
  for (;;) {
    const tasks = await prisma.task.findMany({
      where: { deleted: false, intelligence: { isNot: null } },
      select: {
        id: true, clickupStatus: true, clickupUpdatedAt: true,
        intelligence: { select: { analyzedAt: true, needsAmi: true, confidence: true,
          amiAction: true, amiAttentionScore: true, importanceScore: true, sourceFingerprint: true } }
      },
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!tasks.length) break;
    for (const task of tasks) {
      if (!task.intelligence) continue;
      const result = inspectQuality({ ...task, intelligence: task.intelligence });
      snapshot.inspected++;
      for (const key of ['stale', 'closedAttention', 'invalidScores', 'needsVerification'] as const) {
        if (result[key]) snapshot[key]++;
      }
      // Only provably stale SUCCEEDED work can be corrected without making
      // up a new AI interpretation. The normal AI worker handles its budget.
      if (result.stale) {
        const changed = await prisma.analysisJob.updateMany({
          where: { taskId: task.id, status: 'SUCCEEDED' },
          data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), completedAt: null,
            lastError: 'Quality audit: ClickUp updated since analysis' }
        });
        snapshot.repaired += changed.count;
      }
    }
    cursor = tasks[tasks.length - 1].id;
    if (tasks.length < 100) break;
  }
  return snapshot;
}

async function main() {
  while (!stopping) {
    try {
      const result = await auditOnce();
      await prisma.workerHeartbeat.upsert({
        where: { name: 'quality-worker' },
        create: { name: 'quality-worker', status: 'HEALTHY', lastSeenAt: new Date(),
          lastSuccessAt: new Date(), metadata: result },
        update: { status: 'HEALTHY', lastSeenAt: new Date(), lastSuccessAt: new Date(),
          lastError: null, metadata: result }
      });
      console.log(JSON.stringify({ worker: 'quality-worker', ...result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('quality-worker:', message);
      try {
        await prisma.workerHeartbeat.upsert({
          where: { name: 'quality-worker' },
          create: { name: 'quality-worker', status: 'FAILED', lastSeenAt: new Date(), lastError: message },
          update: { status: 'FAILED', lastSeenAt: new Date(), lastError: message }
        });
      } catch (heartbeatError) { console.error('quality-worker heartbeat:', heartbeatError); }
      if (once) process.exitCode = 1;
    }
    if (once) break;
    // Exit promptly on SIGTERM, without timers or extra CPU work.
    for (let elapsed = 0; elapsed < intervalMs && !stopping; elapsed += 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().finally(() => prisma.$disconnect());
}
