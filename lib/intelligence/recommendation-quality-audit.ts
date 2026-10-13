import { prisma } from '../db/prisma';
import { attentionFingerprint, attentionVerificationReasons, isClosedClickUpStatus } from '../attention/triage';

/**
 * Read-only, bounded quality audit. No OpenAI/ClickUp calls, writes, or UI.
 * Duplicate candidates are diagnostic only and are never hidden automatically.
 */
export async function auditRecommendationQuality() {
  const rows = await prisma.task.findMany({
    where: {
      deleted: false,
      client: { active: true, space: { name: 'JF Corporate' } },
      intelligence: { is: { needsAmi: true } }
    },
    select: {
      id: true, clientId: true, name: true, clickupStatus: true, clickupUpdatedAt: true,
      intelligence: { select: {
        needsAmi: true, agentState: true, sourceFingerprint: true, analyzedAt: true,
        confidence: true, amiAction: true
      } },
      attentionDisposition: { select: { decision: true, reason: true, sourceFingerprint: true } }
    },
    orderBy: { id: 'asc' },
    take: 1001
  });
  // A hard cap avoids growing sync-worker memory without bound.
  const limited = rows.length > 1000;
  const tasks = rows.slice(0, 1000);
  const stats = {
    sampled: tasks.length, truncated: limited, open: 0, completedWithAttention: 0,
    stale: 0, lowConfidence: 0, missingAction: 0,
    duplicateCandidates: 0, reviewed: 0, dismissed: 0,
    dismissalReasons: {} as Record<string, number>
  };
  const keys = new Set<string>();
  for (const task of tasks) {
    const intel = task.intelligence;
    if (!intel) continue;
    const closed = intel.agentState === 'COMPLETED' || isClosedClickUpStatus(task.clickupStatus);
    if (closed) {
      stats.completedWithAttention++;
      continue;
    }
    const disposition = task.attentionDisposition;
    if (disposition?.sourceFingerprint === attentionFingerprint(intel)) {
      if (disposition.decision === 'REVIEWED') stats.reviewed++;
      if (disposition.decision === 'DISMISSED') {
        stats.dismissed++;
        const reason = disposition.reason || 'UNSPECIFIED';
        stats.dismissalReasons[reason] = (stats.dismissalReasons[reason] || 0) + 1;
      }
      continue;
    }
    stats.open++;
    const reasons = attentionVerificationReasons(task);
    if (reasons.includes('ClickUp changed after the AI analysis') || reasons.includes('Analysis timestamp unavailable')) stats.stale++;
    if (reasons.includes('Low or unknown AI confidence')) stats.lowConfidence++;
    if (reasons.includes('No specific action for Ami')) stats.missingAction++;
    // Exact normalized same-client title + recommendation, not semantic deduplication.
    const normalize = (value: string) => value.trim().toLowerCase().replace(/\\s+/g, ' ');
    const key = JSON.stringify([task.clientId, normalize(task.name), normalize(intel.amiAction || '')]);
    if (keys.has(key)) stats.duplicateCandidates++;
    else keys.add(key);
  }
  return stats;
}
