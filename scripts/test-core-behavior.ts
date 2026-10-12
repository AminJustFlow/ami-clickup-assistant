import assert from 'node:assert/strict';
import { attentionFingerprint, attentionVerificationReasons, isClosedClickUpStatus, isOpenAttentionTask } from '../lib/attention/triage';
import { observedChanges, snapshotFromRaw } from '../lib/intelligence/activity-events';
import { lastHumanComment, humanActivityLabel } from '../lib/intelligence/staleness';

const analyzedAt = new Date('2026-10-10T12:00:00Z');
const intel = { needsAmi: true, agentState: 'WAITING_ON_AMI', sourceFingerprint: 'fp-1', analyzedAt };
assert.equal(attentionFingerprint(intel), 'fp-1');
assert.equal(attentionFingerprint({ sourceFingerprint: null, analyzedAt }), 'analyzed:2026-10-10T12:00:00.000Z');
assert.equal(isClosedClickUpStatus(' Complete '), true);
assert.equal(isClosedClickUpStatus('in progress'), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: null }), true);
assert.equal(isOpenAttentionTask({ clickupStatus: 'closed', intelligence: intel, attentionDisposition: null }), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: { sourceFingerprint: 'fp-1', decision: 'DONE' } }), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: { ...intel, sourceFingerprint: 'fp-2' }, attentionDisposition: { sourceFingerprint: 'fp-1', decision: 'DONE' } }), true);

const qualityTask = { clickupUpdatedAt: new Date('2026-10-10T12:05:00Z'), intelligence: { ...intel, confidence: 0.65, amiAction: null } };
assert.deepEqual(attentionVerificationReasons(qualityTask), [
  'ClickUp changed after the AI analysis',
  'Low or unknown AI confidence',
  'No specific action for Ami'
]);
assert.deepEqual(attentionVerificationReasons({
  clickupUpdatedAt: analyzedAt,
  intelligence: { ...intel, confidence: 0.94, amiAction: 'Confirm launch date' }
}), []);

const before = snapshotFromRaw({ id: '1', name: 'Task', status: { status: 'open' }, assignees: [{ id: 2 }], due_date: '1', description: 'A' });
const after = snapshotFromRaw({ id: '1', name: 'Task', status: { status: 'done' }, assignees: [{ id: 3 }], due_date: '1', description: 'A' });
const changes = observedChanges(before, after);
assert.deepEqual(changes.map(change => change.field), ['status', 'assignees']);
assert.equal(changes[0].progressEvidence, true);
assert.equal(changes[1].progressEvidence, false);

const latest = lastHumanComment({ state: 'ACTIVE', taskUpdatedAt: new Date('2026-10-12T00:00:00Z'), commentDates: [new Date('2026-10-09T00:00:00Z'), new Date('2026-10-11T00:00:00Z')] });
assert.equal(latest?.toISOString(), '2026-10-11T00:00:00.000Z');
assert.match(humanActivityLabel({ state: 'ACTIVE', taskUpdatedAt: null, commentDates: [] }, new Date('2026-10-12T00:00:00Z')), /No recorded comments/);

console.log('Core behavior tests passed: attention lifecycle, closed statuses, observed changes, and human-activity chronology.');
