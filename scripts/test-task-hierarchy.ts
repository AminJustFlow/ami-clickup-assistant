import assert from 'node:assert/strict';
import { buildTaskHierarchy, clickupParentId, type HierarchyTask } from '../lib/tasks/hierarchy';
import { groupTaskInsights, groupedInsightRepresentatives } from '../lib/tasks/insight-groups';
import { compareRecentFirst } from '../lib/tasks/recency';

const task = (id: number, parent: string | null, status = 'open'): HierarchyTask => ({
  id, clickupTaskId: String(id), rawPayload: { parent }, name: 'Task ' + id,
  clickupStatus: status, deleted: false
});

assert.equal(clickupParentId({ parent: ' 12 ' }), '12');
assert.equal(clickupParentId({ parent: { id: 'abc' } }), 'abc');
assert.equal(clickupParentId({ parent: null }), null);
assert.equal(clickupParentId({ parent: 'null' }), null);
const tree = buildTaskHierarchy([task(1, null), task(2, '1', 'complete'), task(3, '2'), task(4, '1', 'closed')]);
assert.equal(tree.roots.length, 1);
assert.equal(tree.byId.get(1)?.directChildren, 2);
assert.equal(tree.byId.get(1)?.totalDescendants, 3);
assert.equal(tree.byId.get(1)?.completedDescendants, 2);
assert.equal(tree.byId.get(3)?.depth, 2);
assert.equal(tree.byId.get(3)?.parentId, 2);
const missing = buildTaskHierarchy([task(5, '999')]);
assert.equal(missing.missingParents, 1);
assert.equal(missing.roots.length, 1);
assert.equal(missing.byId.get(5)?.unresolvedParentId, '999');
const self = buildTaskHierarchy([task(6, '6')]);
assert.equal(self.cycles, 1);
assert.equal(self.roots.length, 1);
const loop = buildTaskHierarchy([task(7, '8'), task(8, '7')]);
assert.ok(loop.cycles >= 1);
assert.equal(loop.roots.length, 1);
assert.equal(loop.byId.size, 2);
const deleted = buildTaskHierarchy([{ ...task(9, null), deleted: true }, task(10, '9')]);
assert.equal(deleted.byId.size, 1);
assert.equal(deleted.missingParents, 1);
const grouped = groupTaskInsights(
  [task(11, null), task(12, '11'), task(13, '11'), task(14, null)],
  [task(11, null), task(12, '11'), task(13, '11'), task(14, null)]
);
assert.equal(grouped.length, 2, 'a parent and its subtasks form one insight group');
assert.equal(grouped.find(group => group.groupKey === '11')?.members.length, 3);
const childOnly = groupTaskInsights([task(20, null), task(21, '20')], [task(21, '20')]);
assert.equal(childOnly[0]?.primary.id, 21, 'a matching child remains visible when its parent has no signal');
const recentGroups = groupedInsightRepresentatives([
  { ...task(30, null), clickupUpdatedAt: new Date('2026-01-01T00:00:00Z') },
  { ...task(31, '30'), clickupUpdatedAt: new Date('2026-11-01T00:00:00Z') },
  { ...task(40, null), clickupUpdatedAt: new Date('2026-10-01T00:00:00Z') }
], [
  { ...task(30, null), clickupUpdatedAt: new Date('2026-01-01T00:00:00Z') },
  { ...task(31, '30'), clickupUpdatedAt: new Date('2026-11-01T00:00:00Z') },
  { ...task(40, null), clickupUpdatedAt: new Date('2026-10-01T00:00:00Z') }
], compareRecentFirst);
assert.deepEqual(recentGroups.map(group => group.id), [30, 40], 'a hierarchy is positioned by its newest member while retaining the parent as its label');
console.log('Task hierarchy regression checks passed');
