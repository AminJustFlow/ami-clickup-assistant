import assert from 'node:assert/strict';
import { dependencyTaskIds, type TaskContext } from '../lib/intelligence/context';
import { findRelatedTasks } from '../lib/intelligence/related';

const coverage = { checklistCount: 0, checklistItems: 0, customFields: 0, attachments: 0, linkedTasks: 0, dependencies: 0, missingAttachmentContents: 0 };
function task(id: string, name: string, listName: string, dependencyTaskIds: string[] = []): TaskContext {
  return { taskId: Number(id), clickupTaskId: id, name, listName, dependencyTaskIds,
    description: null, status: 'in progress', priority: null, dueDate: null, updatedAt: null,
    assignees: [], comments: [], extraEvidence: [], coverage };
}
const original = task('1', 'Week 2 Monitoring', 'Operational', ['2']);
const related = task('2', 'Invoice Vendor', 'Invoiced Projects');
const unrelated = task('3', 'Week 2 Monitoring', 'Other List');
const result = findRelatedTasks(original, [original, related, unrelated]);
assert.equal(result[0]?.context.clickupTaskId, '2');
assert.match(result[0].reason, /dependency/i);
assert.equal(result.some(row => row.context.clickupTaskId === '3'), false);
const recurring = task('4', 'Week 1 Monitoring (M, W, F)', 'Operational');
const sameListRecurring = task('5', 'Week 3 Monitoring (M, W, F)', 'Operational');
assert.equal(findRelatedTasks(original, [original, related, recurring, sameListRecurring]).length, 1,
  'An explicit dependency must not be padded with unrelated recurring week tasks');
assert.equal(findRelatedTasks(recurring, [recurring, sameListRecurring]).length, 0,
  'Recurring week titles alone must not imply related deliverables');
assert.deepEqual(dependencyTaskIds({ dependencies: [
  { task_id: '1', depends_on: '2' }, { task_id: '1', depends_on: '2' }, { task_id: '1', depends_on: '3' }
]}, '1'), ['2', '3']);
assert.deepEqual(dependencyTaskIds({ dependencies: [] }, '1'), []);
console.log('Dependency evidence tests passed: exact task IDs, cross-list lookup, deduplication and no inferred generic matches.');
