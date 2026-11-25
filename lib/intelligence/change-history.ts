import type { ConversationCitation } from './conversation';
import { dependencyChanged, handoffSummary, type HandoffEvidence } from './handoff';
import { hasNewProgress } from './progress';
import { prisma } from '../db/prisma';
import { Prisma, type AgentState, type WaitingOnType } from '@prisma/client';

type IntelligenceUpdate = {
  agentState: AgentState;
  needsAmi: boolean;
  waitingOnType: WaitingOnType;
  waitingOnName?: string | null;
  currentSummary: string | null;
  amiAction: string | null;
};

type IntelligenceRecord = Omit<Prisma.TaskIntelligenceUncheckedCreateInput, 'taskId' | 'id'>;

function updateKind(
  prior: { agentState: AgentState; needsAmi: boolean; waitingOnType: WaitingOnType } | null,
  next: IntelligenceUpdate,
  observedEventType?: string
): string {
  if (next.needsAmi && !prior?.needsAmi) return 'DECISION_REQUESTED';
  if (!next.needsAmi && prior?.needsAmi) return 'DECISION_RESOLVED';
  if (next.agentState === 'COMPLETED' && prior?.agentState !== 'COMPLETED') return 'COMPLETED';
  if (prior?.agentState === 'COMPLETED' && next.agentState !== 'COMPLETED') return 'REOPENED';
  if (['BLOCKED', 'ISSUE'].includes(next.agentState) && !['BLOCKED', 'ISSUE'].includes(prior?.agentState ?? '')) return 'BLOCKED';
  if (prior && ['BLOCKED', 'ISSUE'].includes(prior.agentState) && !['BLOCKED', 'ISSUE'].includes(next.agentState)) return 'UNBLOCKED';
  if (observedEventType === 'OBSERVED_DUEDATE_CHANGE') return 'DEADLINE_CHANGED';
  if (observedEventType === 'OBSERVED_ASSIGNEES_CHANGE') return 'OWNERSHIP_CHANGED';
  if (observedEventType === 'OBSERVED_STATUS_CHANGE') return 'STATUS_CHANGED';
  if (prior && dependencyChanged(prior, next)) return 'DEPENDENCY_CHANGED';
  return 'PROGRESS';
}

/**
 * Persist intelligence without treating AI reinterpretations as real-world changes.
 * A repeated identical classification does not produce another change.
 * Serializable isolation and P2034 retries prevent racing analyzers from
 * recording transitions against stale state.
 */
export async function saveTaskIntelligence(taskId: number, next: IntelligenceRecord & IntelligenceUpdate, meaningfulChange: boolean, handoff?: HandoffEvidence, conversation?: ConversationCitation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const prior = await tx.taskIntelligence.findUnique({ where: { taskId } });
        const changed = prior && (
          prior.agentState !== next.agentState ||
          prior.needsAmi !== next.needsAmi ||
          dependencyChanged(prior, next)
        );

        await tx.taskIntelligence.upsert({
          where: { taskId },
          create: { ...next, taskId },
          update: { ...next }
        });

        const fingerprint = typeof next.sourceFingerprint === 'string' ? next.sourceFingerprint : null;
        const analysisSummary = typeof next.lastMeaningfulChange === 'string' && next.lastMeaningfulChange.trim()
          ? next.lastMeaningfulChange.trim()
          : next.currentSummary?.trim() || null;
        const newEvidence = fingerprint && prior?.sourceFingerprint !== fingerprint;
        if (newEvidence && analysisSummary) {
          const observed = prior?.analyzedAt ? await tx.taskEvent.findFirst({
            where: {
              taskId,
              eventType: { in: ['OBSERVED_STATUS_CHANGE', 'OBSERVED_DUEDATE_CHANGE', 'OBSERVED_ASSIGNEES_CHANGE'] },
              occurredAt: { gt: prior.analyzedAt }
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            select: { eventType: true }
          }) : null;
          const kind = updateKind(prior, next, observed?.eventType);
          const summary = kind === 'DEPENDENCY_CHANGED'
            ? prior && meaningfulChange && next.freshnessStatus === 'CURRENT' && handoffSummary(prior, next, prior.analyzedAt, handoff)
            : analysisSummary;
          if (!summary) return { changed: Boolean(changed) };
          const evidenceAt = kind === 'DEPENDENCY_CHANGED' ? handoff!.at
            : next.lastMeaningfulChangeAt instanceof Date ? next.lastMeaningfulChangeAt : null;
          if (kind === 'PROGRESS' && !hasNewProgress(meaningfulChange, next.lastMeaningfulChangeAt, prior?.lastMeaningfulChangeAt, next.lastMeaningfulChange)) {
            return { changed: Boolean(changed) };
          }
          await tx.operationalUpdate.upsert({
            where: { taskId_sourceFingerprint: { taskId, sourceFingerprint: fingerprint } },
            create: {
              taskId, sourceFingerprint: fingerprint, kind, summary,
              impact: next.amiAction?.trim() || next.currentSummary?.trim() || null,
              conversationCitation: conversation ?? Prisma.DbNull,
              evidenceAt,
              verified: next.verificationStatus === 'VERIFIED'
            },
            update: {
              kind, summary,
              impact: next.amiAction?.trim() || next.currentSummary?.trim() || null,
              conversationCitation: conversation ?? Prisma.DbNull,
              evidenceAt,
              verified: next.verificationStatus === 'VERIFIED'
            }
          });
        }

        // Inference changes are not observed ClickUp events.
        return { changed: Boolean(changed) };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Intelligence transaction failed after retries');
}
