import { prisma } from '../db/prisma';
import { attentionFingerprint, attentionVerificationReasons, isClosedClickUpStatus, isOpenAttentionTask } from './triage';
import { briefItemKey, workday } from '../brief/workday';
import { compareAttentionPriority, dailyBrief, decisionPriority } from './daily-brief';
import { groupTaskInsights } from '../tasks/insight-groups';

export const decisionScope = { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } as const;

export async function loadDecisionInbox(now: Date, { clientIds, priority, q }: { clientIds?: number[]; priority?: string; q?: string } = {}) {
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const [candidates, todayReviews] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...decisionScope,
        intelligence: { is: { needsAmi: true } },
        ...(clientIds ? { clientId: { in: clientIds } } : {}),
        ...(q ? { OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { intelligence: { is: { needsAmi: true, amiAction: { contains: q, mode: 'insensitive' as const } } } }
        ] } : {}),
        ...(priority === 'recent' ? { clickupUpdatedAt: { gte: weekAgo } } : {}),
        ...(priority === 'high' ? { intelligence: { is: { needsAmi: true, amiAttentionScore: { gte: 70 } } } } : {}),
        ...(priority === 'overdue' ? { dueDate: { lt: now } } : {})
      },
      select: {
        id: true, clickupTaskId: true, rawPayload: true, clientId: true, name: true, dueDate: true, clickupUpdatedAt: true, clickupUrl: true, clickupStatus: true,
        client: { select: { name: true, slug: true } },
        assignees: { select: { employee: { select: { id: true, name: true } } } },
        comments: { select: { id: true, body: true, authorName: true, clickupCreatedAt: true, clickupUpdatedAt: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
        attentionDisposition: { select: { decision: true, reason: true, sourceFingerprint: true, updatedAt: true } },
        intelligence: { select: {
          classificationVersion: true, amiAction: true, currentSummary: true, agentState: true, waitingOnName: true,
          needsAmi: true, amiAttentionScore: true, analyzedAt: true, sourceFingerprint: true, confidence: true, lastMeaningfulChangeAt: true,
          nextActor: true, unresolvedRequest: true, priorityLevel: true, priorityReasons: true,
          evidenceReferences: true, freshnessStatus: true, verificationStatus: true, verificationReasons: true
        } }
      },
      orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }, { id: 'asc' }]
    }),
    prisma.briefItemReview.findMany({ where: { day: workday(now).day, decision: 'DONE_TODAY' }, select: { itemKey: true } })
  ]);
  const reviewedToday = new Set(todayReviews.map(review => review.itemKey));

  const categorized = candidates.map(task => {
    const intel = task.intelligence!;
    const closed = intel.agentState === 'COMPLETED' || isClosedClickUpStatus(task.clickupStatus);
    const fingerprint = attentionFingerprint(intel);
    const recorded = task.attentionDisposition?.decision === 'DISMISSED' && task.attentionDisposition.sourceFingerprint === fingerprint
      ? 'DISMISSED' : reviewedToday.has(briefItemKey('ACTION', task.id, fingerprint)) ? 'REVIEWED' : null;
    const overdue = !closed && !!task.dueDate && task.dueDate < now;
    const verificationReasons = attentionVerificationReasons(task);
    if (intel.classificationVersion !== 'TASK_ANALYZER_V14_EVIDENCE') verificationReasons.push('Needs current evidence analysis');
    const prioritySignal = decisionPriority(task, now);
    const urgency = verificationReasons.length ? 'Verify recommendation' : `${intel.priorityLevel ?? 'Normal'} priority`;
    return { ...task, prioritySignal, itemKey: briefItemKey('ACTION', task.id, fingerprint), fingerprint, closed, recorded, overdue, urgency, verificationReasons };
  });
  const open = categorized.filter(task => !task.recorded && isOpenAttentionTask(task));
  const active = groupTaskInsights(categorized, open, (a, b) =>
    Number(Boolean(a.verificationReasons.length)) - Number(Boolean(b.verificationReasons.length)) || compareAttentionPriority(a, b, now)
  ).map(({ members }) => ({ ...members[0], insightGroupMembers: members.slice(1) }));
  return { categorized, active, brief: dailyBrief(active, now) };
}
