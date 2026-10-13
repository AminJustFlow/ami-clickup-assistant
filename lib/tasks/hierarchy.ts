/**
 * Read-only ClickUp hierarchy reconstruction from the raw task payload.
 * No schema migration or API writes: parent IDs are already persisted.
 */
import { isClosedClickUpStatus } from '../attention/triage';

export type HierarchyTask = {
  id: number;
  clickupTaskId: string;
  rawPayload: unknown;
  name: string;
  clickupStatus: string | null;
  deleted: boolean;
};

export type HierarchyNode = {
  task: HierarchyTask;
  parentId: number | null;
  depth: number;
  children: HierarchyNode[];
  directChildren: number;
  totalDescendants: number;
  completedDescendants: number;
  unresolvedParentId: string | null;
  cycleDetected: boolean;
};

export function clickupParentId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).parent;
  if (typeof value === 'string' && value.trim() && value !== 'null') return value.trim();
  // Some ClickUp payloads can carry an object rather than an ID.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

export function buildTaskHierarchy(tasks: readonly HierarchyTask[]): {
  roots: HierarchyNode[];
  byId: Map<number, HierarchyNode>;
  missingParents: number;
  cycles: number;
} {
  const active = tasks.filter(task => !task.deleted);
  const byClickupId = new Map(active.map(task => [task.clickupTaskId, task]));
  const byId = new Map<number, HierarchyNode>();
  for (const task of active) {
    byId.set(task.id, {
      task, parentId: null, depth: 0, children: [], directChildren: 0,
      totalDescendants: 0, completedDescendants: 0, unresolvedParentId: null,
      cycleDetected: false
    });
  }
  let missingParents = 0;
  let cycles = 0;
  const parentOf = new Map<number, number>();
  for (const task of active) {
    const parentClickupId = clickupParentId(task.rawPayload);
    if (!parentClickupId) continue;
    const parent = byClickupId.get(parentClickupId);
    if (!parent) {
      byId.get(task.id)!.unresolvedParentId = parentClickupId;
      missingParents++;
    } else {
      parentOf.set(task.id, parent.id);
    }
  }
  // Break cycles deterministically, including self-parenting.
  for (const task of active) {
    const seen = new Set<number>([task.id]);
    let current = parentOf.get(task.id);
    while (current !== undefined) {
      if (seen.has(current)) {
        parentOf.delete(task.id);
        byId.get(task.id)!.cycleDetected = true;
        cycles++;
        break;
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
  const roots: HierarchyNode[] = [];
  for (const task of active) {
    const node = byId.get(task.id)!;
    const parentId = parentOf.get(task.id);
    if (parentId === undefined) roots.push(node);
    else {
      node.parentId = parentId;
      byId.get(parentId)!.children.push(node);
    }
  }
  // Iterative traversal avoids recursion limits for unexpectedly deep trees.
  const stack = roots.map(node => ({ node, depth: 0, visited: false }));
  while (stack.length) {
    const { node, depth, visited } = stack.pop()!;
    if (!visited) {
      node.depth = depth;
      stack.push({ node, depth, visited: true });
      for (const child of node.children) stack.push({ node: child, depth: depth + 1, visited: false });
    } else {
      node.directChildren = node.children.length;
      node.totalDescendants = node.children.reduce((sum, child) => sum + 1 + child.totalDescendants, 0);
      node.completedDescendants = node.children.reduce((sum, child) =>
        sum + Number(isClosedClickUpStatus(child.task.clickupStatus)) + child.completedDescendants, 0);
    }
  }
  return { roots, byId, missingParents, cycles };
}
