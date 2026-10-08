import { createHash } from 'node:crypto';
import type { TaskContext } from './context';
import { TASK_ANALYZER_PROMPT_VERSION, TASK_ANALYZER_SYSTEM } from './prompt';

/**
 * Fingerprint all facts sent to the model, plus the model/prompt and team roster.
 * Stable ordering prevents harmless database retrieval differences from invalidating cache.
 */
export function intelligenceFingerprint(context: TaskContext, model: string, teamNames: string[]): string {
  const evidence = {
    version: TASK_ANALYZER_PROMPT_VERSION,
    instructions: TASK_ANALYZER_SYSTEM,
    model,
    taskId: context.clickupTaskId,
    title: context.name,
    description: context.description,
    status: context.status,
    priority: context.priority,
    dueDate: context.dueDate?.toISOString() ?? null,
    updatedAt: context.updatedAt?.toISOString() ?? null,
    list: context.listName,
    assignees: [...context.assignees].sort(),
    internalTeam: [...teamNames].sort(),
    comments: context.comments.map(c => ({
      id: c.id, author: c.authorName, body: c.body,
      createdAt: c.createdAt?.toISOString() ?? null
    }))
  };
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
