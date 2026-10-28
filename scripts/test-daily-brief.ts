import assert from 'node:assert/strict';
import { briefSince, buildDailyBrief, compareBriefTasks, DAY_MS, formatEastern, type BriefTask, type BriefTaskInput } from '../lib/brief/daily-brief';

const now = new Date('2026-10-28T14:00:00.000Z');
assert.equal(briefSince(undefined, now).toISOString(), new Date(now.getTime() - DAY_MS).toISOString());
assert.equal(briefSince('invalid', now).toISOString(), new Date(now.getTime() - DAY_MS).toISOString());
assert.equal(briefSince('2026-10-29T00:00:00.000Z', now).toISOString(), new Date(now.getTime() - DAY_MS).toISOString());
assert.equal(briefSince('2026-10-27T10:00:00.000Z', now).toISOString(), '2026-10-27T10:00:00.000Z');
assert.match(formatEastern(now), /Oct 28, 2026/);
assert.match(formatEastern(now), /EDT/);

const clients = [
  { id: 1, name: 'Acme (ACM)', slug: 'acme', clickupFolderId: '1', lastSyncedAt: new Date(now.getTime() - 5 * 60_000) },
  { id: 2, name: 'ACM Invoiced Projects', slug: 'acme-invoiced', clickupFolderId: '2', lastSyncedAt: new Date(now.getTime() - 45 * 60_000) },
  { id: 3, name: 'Quiet Client (QTC)', slug: 'quiet', clickupFolderId: '3', lastSyncedAt: null }
];

function task(id: number, overrides: Partial<BriefTaskInput> = {}): BriefTaskInput {
  return {
    id, name: `Task ${id}`, clientId: 1, clickupUrl: `https://app.clickup.com/t/${id}`, clickupStatus: 'open', dueDate: null,
    clickupUpdatedAt: new Date('2026-10-28T12:00:00Z'), deleted: false, comments: [], attentionDisposition: null,
    intelligence: {
      agentState: 'ACTIVE', needsAmi: false, amiAction: null, currentSummary: `Summary ${id}`, waitingOnType: 'NONE', waitingOnName: null,
      importanceScore: 50, amiAttentionScore: 50, riskLevel: 'LOW', lastMeaningfulChange: null,
      lastMeaningfulChangeAt: new Date('2026-10-28T12:00:00Z'), sourceFingerprint: `fp-${id}`, analyzedAt: new Date('2026-10-28T12:30:00Z')
    }, ...overrides
  };
}

const tasks: BriefTaskInput[] = [
  task(1, { dueDate: new Date('2026-10-20T00:00:00Z'), intelligence: { ...task(1).intelligence!, needsAmi: true, agentState: 'WAITING_ON_AMI', amiAttentionScore: 80 } }),
  task(2, { clientId: 2, intelligence: { ...task(2).intelligence!, agentState: 'BLOCKED', riskLevel: 'HIGH', amiAttentionScore: 95 } }),
  task(3, { intelligence: { ...task(3).intelligence!, needsAmi: true, agentState: 'WAITING_ON_AMI', amiAttentionScore: 90 }, attentionDisposition: { sourceFingerprint: 'fp-3', decision: 'REVIEWED' } }),
  task(4, { deleted: true, intelligence: { ...task(4).intelligence!, needsAmi: true, agentState: 'WAITING_ON_AMI' } }),
  task(5, { clickupStatus: 'closed', intelligence: { ...task(5).intelligence!, needsAmi: true, agentState: 'WAITING_ON_AMI' } }),
  task(6, { clientId: 3, intelligence: null }),
  task(7, { intelligence: { ...task(7).intelligence!, agentState: 'COMPLETED', lastMeaningfulChangeAt: new Date('2026-10-28T11:00:00Z') } }),
  task(8, { clickupUpdatedAt: new Date('2026-08-01T00:00:00Z'), intelligence: { ...task(8).intelligence!, lastMeaningfulChangeAt: new Date('2026-08-01T00:00:00Z') } })
];
const brief = buildDailyBrief({ now, since: new Date('2026-10-27T14:00:00Z'), clients, tasks, changes: [{ taskId: 7, nextState: 'COMPLETED', nextNeedsAmi: false, detectedAt: new Date('2026-10-28T11:00:00Z') }] });
assert.deepEqual(brief.decisions.map(item => item.id), [1]);
assert.deepEqual(brief.newRisks.map(item => item.id), [2]);
assert.deepEqual(brief.progress.map(item => item.id), [7]);
assert.equal(brief.coverage.imported, 7);
assert.equal(brief.coverage.analyzed, 6);
assert.equal(brief.coverage.staleClientCount, 2);
assert.equal(brief.totals.stale, 1);
assert.equal(brief.clients.length, 2);
assert.equal(brief.clients.find(client => client.slug === 'acme')?.imported, 6, 'auxiliary folders consolidate into the canonical client');
assert.equal(brief.clients.find(client => client.slug === 'quiet')?.healthy, true);

const base = { id: 1, name: 'x', clientName: 'x', clientSlug: 'x', clickupUrl: null, clickupStatus: 'open', dueDate: null, clickupUpdatedAt: now, evidenceAt: now, analyzedAt: now, summary: null, action: null, state: 'ACTIVE', risk: 'LOW', waitingOnType: 'NONE', waitingOnName: null, attentionScore: 1, overdue: false } satisfies Omit<BriefTask, 'priority'>;
const ordered: BriefTask[] = [{ ...base, id: 5, priority: 'DEPENDENCY' }, { ...base, id: 3, priority: 'AMI_DECISION' }, { ...base, id: 1, priority: 'OVERDUE_DECISION' }, { ...base, id: 2, priority: 'HIGH_RISK' }, { ...base, id: 4, priority: 'STALE' }];
ordered.sort(compareBriefTasks);
assert.deepEqual(ordered.map(item => item.priority), ['OVERDUE_DECISION', 'HIGH_RISK', 'AMI_DECISION', 'STALE', 'DEPENDENCY']);

console.log('Daily brief tests passed: checkpoints, time zone, ranking, exclusions, grouping, freshness, coverage, and progress.');
