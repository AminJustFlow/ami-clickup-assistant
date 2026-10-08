import { prisma } from '../db/prisma';
import type { AgentState, WaitingOnType, Prisma } from '@prisma/client';

type IntelligenceUpdate = {
  agentState: AgentState;
  needsAmi: boolean;
  waitingOnType: WaitingOnType;
  currentSummary: string | null;
  amiAction: string | null;
};

type IntelligenceRecord = Omit<Prisma.TaskIntelligenceUncheckedCreateInput, 'taskId' | 'id'>;

/**
 * Persist intelligence and its state transition together.
 * A repeated identical classification does not produce another change.
 * Serializable isolation and P2034 retries prevent racing analyzers from
 * recording transitions against stale state.
 */
export async function saveTaskIntelligence(taskId: number, next: IntelligenceRecord & IntelligenceUpdate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const prior = await tx.taskIntelligence.findUnique({ where: { taskId } });
        const changed = prior && (
          prior.agentState !== next.agentState ||
          prior.needsAmi !== next.needsAmi ||
          prior.waitingOnType !== next.waitingOnType
        );

        await tx.taskIntelligence.upsert({
          where: { taskId },
          create: { ...next, taskId },
          update: { ...next }
        });

        if (changed) {
          await tx.intelligenceChange.create({
            data: {
              taskId,
              previousState: prior.agentState,
              nextState: next.agentState,
              previousNeedsAmi: prior.needsAmi,
              nextNeedsAmi: next.needsAmi,
              previousWaitingOnType: prior.waitingOnType,
              nextWaitingOnType: next.waitingOnType,
              summary: next.currentSummary,
              amiAction: next.amiAction
            }
          });
        }
        return { changed: Boolean(changed) };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2034' || attempt === 2) throw error;
    }
  }
  throw new Error('Intelligence transaction failed after retries');
}
