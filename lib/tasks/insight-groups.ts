import { clickupParentId } from './hierarchy';

export type InsightHierarchyTask = {
  id: number;
  clickupTaskId: string;
  rawPayload: unknown;
};

export type GroupedInsight<T> = {
  primary: T;
  members: T[];
  groupKey: string;
};

/**
 * Collapses task-level signals into ClickUp work hierarchies. The complete task
 * collection is used to find the root even when only a child matches a signal.
 * Members remain available so the UI never loses a distinct child action.
 */
export function groupTaskInsights<T extends InsightHierarchyTask>(
  allTasks: readonly T[],
  matchingTasks: readonly T[],
  compare: (a: T, b: T) => number = () => 0
): GroupedInsight<T>[] {
  const byClickupId = new Map(allTasks.map(task => [task.clickupTaskId, task]));
  const rootId = (task: T): string => {
    const seen = new Set<string>([task.clickupTaskId]);
    let current = task;
    while (true) {
      const parentId = clickupParentId(current.rawPayload);
      if (!parentId || seen.has(parentId)) return current.clickupTaskId;
      const parent = byClickupId.get(parentId);
      if (!parent) return current.clickupTaskId;
      seen.add(parentId);
      current = parent;
    }
  };

  const buckets = new Map<string, T[]>();
  for (const task of matchingTasks) {
    const key = rootId(task);
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  return [...buckets.entries()].map(([groupKey, values]) => {
    const members = [...values].sort(compare);
    const root = members.find(task => task.clickupTaskId === groupKey);
    return { groupKey, primary: root ?? members[0], members };
  }).sort((a, b) => compare(a.primary, b.primary));
}

export function groupedInsightRepresentatives<T extends InsightHierarchyTask>(
  allTasks: readonly T[], matchingTasks: readonly T[], compare?: (a: T, b: T) => number
): Array<T & { insightGroupMembers?: T[] }> {
  return groupTaskInsights(allTasks, matchingTasks, compare).map(group =>
    Object.assign(group.primary, { insightGroupMembers: group.members.filter(member => member.id !== group.primary.id) })
  );
}
