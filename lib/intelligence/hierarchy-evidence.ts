import { clickupParentId } from '../tasks/hierarchy';
import type { TaskContext } from './context';
import type { RelatedEvidence } from './related';

export type HierarchyCandidate = {
  clickupTaskId: string;
  rawPayload: unknown;
  context: TaskContext;
};

/**
 * Prioritize direct parent and children as supporting evidence.
 * Bounded to the existing related-evidence cap; no extra model requests.
 * Parent and child completion remain independent.
 */
export function hierarchyRelatedEvidence(
  target: HierarchyCandidate,
  candidates: readonly HierarchyCandidate[],
  existing: readonly RelatedEvidence[],
  limit = 3
): RelatedEvidence[] {
  const parentId = clickupParentId(target.rawPayload);
  const hierarchy = candidates
    .filter(other => other.clickupTaskId !== target.clickupTaskId)
    .map(other => {
      const isParent = parentId === other.clickupTaskId;
      const isChild = clickupParentId(other.rawPayload) === target.clickupTaskId;
      return isParent || isChild ? {
        context: other.context,
        reason: isParent
          ? 'Direct ClickUp parent task (status is not proof of this task completion)'
          : 'Direct ClickUp subtask (status is not proof of parent completion)',
        priority: isParent ? 0 : 1
      } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.priority - b.priority || a.context.clickupTaskId.localeCompare(b.context.clickupTaskId))
    .map(({ context, reason }) => ({ context, reason }));
  const merged: RelatedEvidence[] = [];
  const seen = new Set<string>([target.clickupTaskId]);
  for (const item of [...hierarchy, ...existing]) {
    if (seen.has(item.context.clickupTaskId)) continue;
    seen.add(item.context.clickupTaskId);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}
