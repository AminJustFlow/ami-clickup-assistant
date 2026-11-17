import { prisma } from '@/lib/db/prisma';
import { isClosedClickUpStatus, attentionFingerprint } from '@/lib/attention/triage';
import { compareRecentFirst } from '@/lib/tasks/recency';
import { operationalReadiness, operationalScopeWhere } from '@/lib/operations/readiness';
import { briefItemKey, workday } from './workday';

const taskSelect = {
  id: true, name: true, clickupStatus: true, clickupUpdatedAt: true, dueDate: true, clickupUrl: true,
  clientId: true, rawPayload: true,
  client: { select: { name: true, slug: true } },
  assignees: { select: { employee: { select: { id: true, name: true } } } },
  attentionDisposition: { select: { decision: true, sourceFingerprint: true } },
  intelligence: { select: {
    agentState: true, needsAmi: true, amiAction: true, currentSummary: true, riskLevel: true,
    waitingOnName: true, waitingOnType: true, priorityLevel: true, priorityReasons: true,
    lastMeaningfulChangeAt: true, sourceFingerprint: true, analyzedAt: true,
    verificationStatus: true, evidenceReferences: true, classificationVersion: true, confidence: true
  } }
} as const;

async function loadActionCandidates() {
  return prisma.task.findMany({
    where: { deleted: false, intelligence: { is: { needsAmi: true, verificationStatus: 'VERIFIED', classificationVersion: 'TASK_ANALYZER_V14_EVIDENCE' } } },
    select: taskSelect, orderBy: [{ clickupUpdatedAt: 'desc' }, { id: 'asc' }], take: 60
  });
}

type CommandTask = Awaited<ReturnType<typeof loadActionCandidates>>[number];

function activeAction(task: CommandTask): boolean {
  const intel = task.intelligence;
  if (!intel || isClosedClickUpStatus(task.clickupStatus) || intel.agentState === 'COMPLETED') return false;
  const disposition = task.attentionDisposition;
  return !(disposition?.decision === 'DISMISSED' && disposition.sourceFingerprint === attentionFingerprint(intel));
}

export async function loadCommandCenter(now = new Date()) {
  const current = workday(now);
  const [readiness, actionRows, updates, riskRows, reviews, brief] = await Promise.all([
    operationalReadiness(now),
    loadActionCandidates(),
    prisma.operationalUpdate.findMany({
      where: { verified: true, OR: [
        { evidenceAt: { gte: current.previousStart } },
        { evidenceAt: null, createdAt: { gte: current.previousStart } }
      ], task: { deleted: false } },
      include: { task: { select: taskSelect } },
      orderBy: [{ evidenceAt: 'desc' }, { createdAt: 'desc' }], take: 60
    }),
    prisma.task.findMany({
      where: { AND: [operationalScopeWhere(now), { intelligence: { is: {
        classificationVersion: 'TASK_ANALYZER_V14_EVIDENCE', confidence: { gte: 0.75 },
        OR: [{ agentState: { in: ['BLOCKED', 'ISSUE'] } }, { riskLevel: { in: ['HIGH', 'CRITICAL'] } }]
      } } }] },
      select: taskSelect, orderBy: [{ clickupUpdatedAt: 'desc' }, { id: 'asc' }], take: 40
    }),
    prisma.briefItemReview.findMany({ where: { day: current.day }, select: { itemKey: true } }),
    prisma.workdayBrief.findUnique({ where: { day: current.day } })
  ]);
  const reviewed = new Set(reviews.map(item => item.itemKey));
  const actions = actionRows.filter(activeAction).sort(compareRecentFirst).map(task => {
    const fingerprint = task.intelligence?.sourceFingerprint ?? null;
    return { ...task, itemKey: briefItemKey('ACTION', task.id, fingerprint), fingerprint };
  });
  const visibleActions = actions.filter(item => !reviewed.has(item.itemKey));
  const actionIds = new Set(actions.map(item => item.id));
  const changeItems = updates
    .filter(update => !actionIds.has(update.taskId) || update.kind === 'DECISION_RESOLVED')
    .map(update => ({ ...update, itemKey: briefItemKey('CHANGE', update.taskId, update.sourceFingerprint), fingerprint: update.sourceFingerprint }))
    .filter(item => !reviewed.has(item.itemKey));
  const risks = riskRows.filter(task => !actionIds.has(task.id) && !isClosedClickUpStatus(task.clickupStatus)).sort(compareRecentFirst).map(task => {
    const fingerprint = task.intelligence?.sourceFingerprint ?? null;
    return { ...task, itemKey: briefItemKey('RISK', task.id, fingerprint), fingerprint };
  }).filter(item => !reviewed.has(item.itemKey));

  const signals = [...visibleActions.map(task => ({ task, clientId: task.clientId, client: task.client, type: 'decision' })),
    ...changeItems.map(update => ({ task: update.task, clientId: update.task.clientId, client: update.task.client, type: 'change' })),
    ...risks.map(task => ({ task, clientId: task.clientId, client: task.client, type: 'risk' }))];
  const clientMap = new Map<number, { name: string; slug: string; decisions: number; changes: number; risks: number }>();
  for (const signal of signals) {
    const entry = clientMap.get(signal.clientId) ?? { ...signal.client, decisions: 0, changes: 0, risks: 0 };
    if (signal.type === 'decision') entry.decisions++;
    if (signal.type === 'change') entry.changes++;
    if (signal.type === 'risk') entry.risks++;
    clientMap.set(signal.clientId, entry);
  }
  const clients = [...clientMap.values()].sort((a, b) =>
    (b.decisions * 10 + b.risks * 5 + b.changes) - (a.decisions * 10 + a.risks * 5 + a.changes) || a.name.localeCompare(b.name));

  const teamMap = new Map<number, { id: number; name: string; decisions: number; changes: number; risks: number }>();
  for (const signal of signals) {
    for (const assignment of signal.task.assignees) {
      const person = assignment.employee;
      const entry = teamMap.get(person.id) ?? { ...person, decisions: 0, changes: 0, risks: 0 };
      if (signal.type === 'decision') entry.decisions++;
      if (signal.type === 'change') entry.changes++;
      if (signal.type === 'risk') entry.risks++;
      teamMap.set(person.id, entry);
    }
  }
  const team = [...teamMap.values()].sort((a, b) =>
    (b.decisions * 10 + b.risks * 5 + b.changes) - (a.decisions * 10 + a.risks * 5 + a.changes) || a.name.localeCompare(b.name));

  return {
    current, readiness, completedAt: brief?.completedAt ?? null,
    actions: visibleActions.slice(0, 3), actionTotal: visibleActions.length,
    changes: changeItems.slice(0, 5), changeTotal: changeItems.length,
    risks: risks.slice(0, 3), riskTotal: risks.length,
    clients: clients.slice(0, 3), team: team.slice(0, 3), reviewedToday: reviews.length
  };
}
