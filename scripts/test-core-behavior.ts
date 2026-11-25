import { conversationCitation, groupConversationUpdates } from '../lib/intelligence/conversation';
import { handoffEvidence, handoffSummary } from '../lib/intelligence/handoff';
import { hasNewProgress } from '../lib/intelligence/progress';
import { intelligenceCoverage } from '../lib/intelligence/coverage';
import { TASK_ANALYZER_PROMPT_VERSION } from '../lib/intelligence/prompt';
import assert from 'node:assert/strict';
import { clientHealthStatus, compareClientHealth, dueWithinDays } from '../lib/clients/health';
import { compareAttentionPriority, dailyBrief, decisionPriority } from '../lib/attention/daily-brief';
import { attentionFingerprint, attentionVerificationReasons, hasSpecificAmiAction, isClosedClickUpStatus, isOpenAttentionTask, isVerifiedOpenAttentionTask } from '../lib/attention/triage';
import { observedChanges, snapshotFromRaw } from '../lib/intelligence/activity-events';
import { lastHumanComment, humanActivityLabel } from '../lib/intelligence/staleness';
import { compareRecentFirst, latestActivityTime } from '../lib/tasks/recency';
import { briefItemKey, workday } from '../lib/brief/workday';

const healthy = { name: 'Alpha', total: 10, analyzed: 10, needsAmi: 0, overdue: 0, blocked: 0, waiting: 0, dueSoon: 0 };
assert.equal(clientHealthStatus(healthy), 'No flagged issues');
assert.equal(clientHealthStatus({ ...healthy, analyzed: 0 }), 'Insufficient analysis');
assert.equal(clientHealthStatus({ ...healthy, waiting: 1 }), 'Watch');
assert.equal(clientHealthStatus({ ...healthy, dueSoon: 1 }), 'Watch');
assert.equal(clientHealthStatus({ ...healthy, blocked: 1 }), 'Attention needed');
assert.equal(clientHealthStatus({ ...healthy, needsAmi: 1 }), 'Attention needed');
assert.equal(compareClientHealth({ ...healthy, name: 'Beta', overdue: 1 }, healthy) < 0, true);
assert.equal(compareClientHealth({ ...healthy, name: 'Beta', dueSoon: 1 }, healthy) < 0, true);
const healthClock = new Date('2026-10-13T12:00:00Z');
assert.equal(dueWithinDays(new Date('2026-10-20T12:00:00Z'), healthClock), true);
assert.equal(dueWithinDays(new Date('2026-10-20T12:00:01Z'), healthClock), false);
assert.equal(dueWithinDays(new Date('2026-10-12T12:00:00Z'), healthClock), false);
assert.equal(dueWithinDays(null, healthClock), false);

const analyzedAt = new Date('2026-10-10T12:00:00Z');
const intel = { needsAmi: true, agentState: 'WAITING_ON_AMI', sourceFingerprint: 'fp-1', analyzedAt,
  verificationStatus: 'VERIFIED', verificationReasons: [], nextActor: 'AMI', unresolvedRequest: 'Confirm launch date',
  evidenceReferences: [{ source_type: 'COMMENT', source_id: '1', excerpt: 'Ami, please confirm launch date.' }], freshnessStatus: 'CURRENT' };
assert.equal(attentionFingerprint(intel), 'fp-1');
assert.equal(attentionFingerprint({ sourceFingerprint: null, analyzedAt }), 'analyzed:2026-10-10T12:00:00.000Z');
assert.equal(isClosedClickUpStatus(' Complete '), true);
assert.equal(isClosedClickUpStatus('in progress'), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: null }), true);
assert.equal(isVerifiedOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: null }), true);
assert.equal(isVerifiedOpenAttentionTask({ clickupStatus: 'open', intelligence: { ...intel, verificationStatus: null }, attentionDisposition: null }), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'closed', intelligence: intel, attentionDisposition: null }), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: { sourceFingerprint: 'fp-1', decision: 'REVIEWED' } }), true, 'daily review must not permanently hide unresolved work');
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: intel, attentionDisposition: { sourceFingerprint: 'fp-1', decision: 'DISMISSED' } }), false);
assert.equal(isOpenAttentionTask({ clickupStatus: 'open', intelligence: { ...intel, sourceFingerprint: 'fp-2' }, attentionDisposition: { sourceFingerprint: 'fp-1', decision: 'DISMISSED' } }), true);

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

// Model placeholders and invalid confidence must never become ready-to-act decisions.
for (const action of [null, '', '   ', 'N/A', 'none', 'Unknown', 'TBD', 'No action needed', 'not applicable', '...', 'Review this task', 'Check status', 'Follow up', 'Monitor progress', 'Investigate issue', 'Look into this', 'Take action', 'Needs attention', 'Action required', 'Awaiting update']) {
  assert.equal(hasSpecificAmiAction(action), false, String(action));
}
for (const action of ['Confirm launch date', 'Review client feedback', 'Follow up with vendor', 'Review the client-approved homepage copy', 'Check status with Erika on the booking integration', 'Investigate the failed payment on order 123']) {
  assert.equal(hasSpecificAmiAction(action), true, action);
}
assert.deepEqual(attentionVerificationReasons({
  clickupUpdatedAt: analyzedAt,
  intelligence: { ...intel, confidence: 0.9, amiAction: 'N/A' }
}), ['No specific action for Ami']);
assert.deepEqual(attentionVerificationReasons({
  clickupUpdatedAt: analyzedAt,
  intelligence: { ...intel, confidence: 0.95, amiAction: 'Review this task' }
}), ['No specific action for Ami']);
assert.deepEqual(attentionVerificationReasons({
  clickupUpdatedAt: analyzedAt,
  intelligence: { ...intel, confidence: 1.5, amiAction: 'Confirm launch date' }
}), ['Low or unknown AI confidence']);
assert.deepEqual(attentionVerificationReasons({
  clickupUpdatedAt: analyzedAt,
  intelligence: { ...intel, confidence: Number.NaN, amiAction: 'Confirm launch date' }
}), ['Low or unknown AI confidence']);

const brief = dailyBrief([
  { id: 1, overdue: true, verificationReasons: ['Low confidence'], intelligence: { amiAttentionScore: 95 } },
  { id: 2, overdue: false, verificationReasons: [], intelligence: { amiAttentionScore: 70 } },
  { id: 3, overdue: true, verificationReasons: [], intelligence: { amiAttentionScore: 30 } },
  { id: 4, overdue: false, verificationReasons: [], intelligence: { amiAttentionScore: 80 } }
]);
assert.deepEqual({ open: brief.open, ready: brief.ready, verify: brief.verify, overdueReady: brief.overdueReady }, { open: 4, ready: 3, verify: 1, overdueReady: 1 });
assert.deepEqual(brief.topReady.map(item => item.id), [4, 2, 3]);
assert.deepEqual(brief.topToVerify.map(item => item.id), [1]);
assert.deepEqual(dailyBrief([]).topReady, []);

// Deadline-aware ranking, without putting unverified items in the ready brief.
const clock = new Date('2026-10-13T12:00:00Z');
const item = (id: number, due: string | null, score: number, overdue = false, verificationReasons: string[] = []) => ({
  id, dueDate: due ? new Date(due) : null, overdue, verificationReasons,
  clickupUpdatedAt: clock, intelligence: { amiAttentionScore: score }
});
const ranked = dailyBrief([
  item(1, null, 99),
  item(2, '2026-10-15T10:00:00Z', 15),
  item(3, '2026-10-13T16:00:00Z', 20),
  item(4, '2026-10-12T10:00:00Z', 5, true),
  item(5, '2026-10-13T13:00:00Z', 100, false, ['Low confidence'])
], clock);
assert.deepEqual(ranked.topReady.map(task => task.id), [3, 2, 1]);
assert.deepEqual(ranked.topToVerify.map(task => task.id), [5]);
assert.equal(compareAttentionPriority(item(1, null, 70), item(2, null, 60), clock) < 0, true);
assert.equal(compareAttentionPriority(item(1, null, 70), item(2, null, 70), clock) < 0, true);

const recencyTasks = [
  { id: 1, clickupUpdatedAt: new Date('2026-01-30T12:00:00Z'), dueDate: new Date('2026-01-30T12:00:00Z') },
  { id: 2, clickupUpdatedAt: new Date('2026-11-01T12:00:00Z') },
  { id: 3, clickupUpdatedAt: new Date('2026-10-01T12:00:00Z'), comments: [{ clickupCreatedAt: new Date('2026-11-10T12:00:00Z') }] }
].sort(compareRecentFirst);
assert.deepEqual(recencyTasks.map(task => task.id), [3, 2, 1], 'latest real activity always wins over old due dates');
assert.equal(latestActivityTime({ id: 4, clickupUpdatedAt: null }), 0);
assert.equal(workday(new Date('2026-11-17T08:59:00Z')).key, '2026-11-16', 'the ET workday does not reset before 4 AM');
assert.equal(workday(new Date('2026-11-17T09:00:00Z')).key, '2026-11-17', 'the ET workday resets at 4 AM');
assert.equal(briefItemKey('ACTION', 12, 'fp-1'), 'ACTION:12:fp-1');


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

const sourceAssessment = {
  analyzedAt: new Date(1000), classificationVersion: TASK_ANALYZER_PROMPT_VERSION,
  freshnessStatus: 'CURRENT', verificationStatus: 'VERIFIED'
};
const covered = { clickupUpdatedAt: new Date(0), intelligence: sourceAssessment, comments: [] };
assert.deepEqual(intelligenceCoverage([
  covered, { ...covered, intelligence: null },
  { ...covered, comments: [{ clickupCreatedAt: new Date(0), clickupUpdatedAt: new Date(1001) }] },
  { ...covered, intelligence: { ...sourceAssessment, verificationStatus: 'VERIFY' } }
]), { current: 2, stale: 1, unanalyzed: 1, verification: 1 });

const answered = { clickupUpdatedAt: analyzedAt, clickupStatus: 'open', attentionDisposition: null,
  intelligence: { ...intel, confidence: 0.94, amiAction: 'Review the draft post' },
  comments: [{ clickupCreatedAt: new Date(analyzedAt.getTime() + 1), clickupUpdatedAt: null }] };
assert.equal(isVerifiedOpenAttentionTask(answered), false);
assert.ok(attentionVerificationReasons(answered).includes('ClickUp changed after the AI analysis'));

const milestone = new Date('2026-11-25T15:00:00Z');
for (const summary of ['No substantive work or comment activity is recorded', 'No meaningful progress or operational change is documented', 'No meaningful execution change is documented', 'No meaningful progress is recorded']) {
  assert.equal(hasNewProgress(true, milestone, null, summary), false);
}
assert.equal(hasNewProgress(true, milestone, null, 'Flyer proof delivered to client'), true);
assert.equal(hasNewProgress(false, milestone, null, 'Task reviewed'), false);
assert.equal(hasNewProgress(true, milestone, milestone, 'Flyer proof delivered to client'), false);
assert.equal(hasNewProgress(true, null, null, 'Task remains To Do'), false);

const handoffComment = { id: 17, body: 'Stefani, please revise the reel.', authorName: 'Ami', createdAt: milestone };
const proof = handoffEvidence([handoffComment], { comment_id: 17, excerpt: handoffComment.body });
const firstOwner = { waitingOnType: 'TEAM', waitingOnName: 'Dominic' } as const;
const nextOwner = { waitingOnType: 'TEAM', waitingOnName: 'Stefani' } as const;
const baseline = new Date(milestone.getTime() - 1000);
assert.equal(handoffEvidence([handoffComment], { comment_id: 18, excerpt: handoffComment.body }), undefined);
assert.equal(handoffEvidence([handoffComment], { comment_id: 17, excerpt: 'Ready for publication' }), undefined);
assert.equal(handoffSummary(firstOwner, nextOwner, baseline, proof), 'Handoff from Dominic to Stefani. Ami: "Stefani, please revise the reel."');
assert.equal(handoffSummary(firstOwner, nextOwner, milestone, proof), null);
assert.equal(handoffSummary(firstOwner, nextOwner, baseline), null);
assert.equal(handoffSummary(nextOwner, nextOwner, baseline, proof), null);
assert.equal(handoffSummary({ waitingOnType: 'NONE' }, nextOwner, baseline, proof)?.startsWith('Now waiting on Stefani.'), true);
const cleared = handoffEvidence([{ ...handoffComment, body: 'I approved the reel.' }], { comment_id: 17, excerpt: 'I approved the reel.' });
assert.equal(handoffSummary(nextOwner, { waitingOnType: 'NONE' }, baseline, cleared)?.startsWith('No longer waiting on Stefani.'), true);

const recentRequest = {
  ...item(8, '2026-10-04T12:00:00Z', 20, true),
  comments: [{ id: 6, authorName: 'Rayanne', body: 'Please approve the flyer proof.', clickupCreatedAt: clock }],
  intelligence: { amiAttentionScore: 20, unresolvedRequest: 'Approve the flyer proof.', evidenceReferences: [
    { source_type: 'COMMENT', source_id: '6', excerpt: 'Please approve the flyer proof.' }
  ] }
};
const oldDeadline = item(9, '2026-10-01T12:00:00Z', 99, true);
const openDecision = item(10, null, 50);
assert.deepEqual(dailyBrief([oldDeadline, openDecision, recentRequest], clock).orderedReady.map(t => t.id), [8, 10, 9]);
assert.match(decisionPriority(recentRequest, clock).reason, /Rayanne on Oct 13: Please approve the flyer proof/);
assert.equal(decisionPriority({ ...recentRequest, comments: [] }, clock).tier, decisionPriority(oldDeadline, clock).tier);

const blockedRequest = 'We are waiting for approval before we can print.';
const waiting = { ...recentRequest, dueDate: null,
  comments: [{ ...recentRequest.comments[0], body: blockedRequest }],
  intelligence: { ...recentRequest.intelligence, evidenceReferences: [{ source_type: 'COMMENT', source_id: '6', excerpt: blockedRequest }] }
};
assert.ok(decisionPriority(waiting, clock).tier < decisionPriority({ ...recentRequest, dueDate: null }, clock).tier);
assert.equal(decisionPriority({ ...waiting, comments: recentRequest.comments }, clock).evidenceAt, 0);

const sharedSource = conversationCitation([handoffComment], { comment_id: handoffComment.id, excerpt: handoffComment.body });
assert.ok(sharedSource);
assert.equal(conversationCitation([handoffComment], { comment_id: 999, excerpt: handoffComment.body }), undefined);
assert.equal(conversationCitation([handoffComment], { comment_id: handoffComment.id, excerpt: 'Different request' }), undefined);
const original = { taskId: 1, task: { clientId: 1 }, kind: 'DECISION_REQUESTED', conversationCitation: sharedSource };
const followup = { ...sharedSource, commentId: sharedSource.commentId + 1 };
const conversations = groupConversationUpdates([
  original, { ...original, taskId: 2 }, { ...original, taskId: 3 }, { ...original, taskId: 2, conversationCitation: followup },
  { ...original, taskId: 4, conversationCitation: { ...sharedSource, excerpt: 'A separate instruction.' } },
  { ...original, task: { clientId: 2 } }, { ...original, kind: 'DECISION_RESOLVED' },
  { ...original, conversationCitation: null }, { ...original, conversationCitation: null }
]);
assert.deepEqual(conversations.map(group => group.items.length), [3, 1, 1, 1, 1, 1, 1]);
