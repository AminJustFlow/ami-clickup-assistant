import assert from 'node:assert/strict';
import { hierarchyRelatedEvidence } from '../lib/intelligence/hierarchy-evidence';
import type { TaskContext } from '../lib/intelligence/context';

function task(id: string, parent: string | null) {
  const context = { clickupTaskId: id, taskId: Number(id), name: 'Task '+id } as TaskContext;
  return { clickupTaskId: id, rawPayload: { parent }, context };
}
const parent = task('1', null), child = task('2', '1'), sibling = task('3', '1'), unrelated = task('4', null);
const childRelated = hierarchyRelatedEvidence(child, [parent, child, sibling, unrelated], [{ context: unrelated.context, reason: 'Explicit reference' }]);
assert.deepEqual(childRelated.map(x => x.context.clickupTaskId), ['1','4']);
assert.match(childRelated[0].reason, /parent/);
const parentRelated = hierarchyRelatedEvidence(parent, [parent, child, sibling, unrelated], [{ context: child.context, reason: 'Title overlap' }, { context: unrelated.context, reason: 'Reference' }]);
assert.deepEqual(parentRelated.map(x => x.context.clickupTaskId), ['2','3','4']);
assert.match(parentRelated[0].reason, /subtask/);
assert.deepEqual(hierarchyRelatedEvidence(parent, [parent, child, sibling], [], 1).map(x => x.context.clickupTaskId), ['2']);
assert.deepEqual(hierarchyRelatedEvidence(unrelated, [parent, child, sibling, unrelated], []).map(x => x.context.clickupTaskId), []);
console.log('Hierarchy AI evidence regression checks passed');
