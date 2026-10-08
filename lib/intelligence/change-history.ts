import { prisma } from '../db/prisma';
import type { AgentState, WaitingOnType } from '@prisma/client';

export async function saveIntelligenceChange(taskId: number, next: {
  agentState: AgentState; needsAmi: boolean; waitingOnType: WaitingOnType;
  currentSummary: string | null; amiAction: string | null;
}) {
  return prisma.$transaction(async tx => {
    const prior = await tx.taskIntelligence.findUnique({ where: { taskId } });
    if (!prior) return;
    if (prior.agentState === next.agentState &&
        prior.needsAmi === next.needsAmi &&
        prior.waitingOnType === next.waitingOnType) return;
    await tx.intelligenceChange.create({ data: {
      taskId, previousState: prior.agentState, nextState: next.agentState,
      previousNeedsAmi: prior.needsAmi, nextNeedsAmi: next.needsAmi,
      previousWaitingOnType: prior.waitingOnType, nextWaitingOnType: next.waitingOnType,
      summary: next.currentSummary, amiAction: next.amiAction
    } });
  });
}
