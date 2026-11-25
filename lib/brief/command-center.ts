import { prisma } from '@/lib/db/prisma';
import { isClosedClickUpStatus, attentionVerificationReasons, isOpenAttentionTask } from '@/lib/attention/triage';
import { compareRecentFirst } from '@/lib/tasks/recency';
import { operationalReadiness, operationalScopeWhere } from '@/lib/operations/readiness';
import { AMI_EMPLOYEE_NAME } from '@/lib/operations/identity';
import { clickupParentId } from '@/lib/tasks/hierarchy';
import { briefItemKey, workday } from './workday';
import type { Prisma } from '@prisma/client';

const taskSelect = {
  id: true, clickupTaskId: true, name: true, clickupStatus: true, clickupCreatedAt: true, clickupUpdatedAt: true, dueDate: true, clickupUrl: true,
  comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
  deleted: true,
  clientId: true, rawPayload: true,
  client: { select: { name: true, slug: true } },
  assignees: { select: { employee: { select: { id: true, name: true } } } },
  attentionDisposition: { select: { decision: true, sourceFingerprint: true } },
  intelligence: { select: {
    agentState: true, needsAmi: true, amiAction: true, currentSummary: true, riskLevel: true,
    waitingOnName: true, waitingOnType: true, priorityLevel: true, priorityReasons: true,
    lastMeaningfulChangeAt: true, sourceFingerprint: true, analyzedAt: true,
    freshnessStatus: true, nextActor: true, unresolvedRequest: true, verificationReasons: true, verificationStatus: true, evidenceReferences: true, classificationVersion: true, confidence: true
  } }
} as const;

async function loadActionCandidates(now: Date) {
  return prisma.task.findMany({
    where: { AND: [operationalScopeWhere(now), { intelligence: { is: { needsAmi: true, verificationStatus: 'VERIFIED', classificationVersion: 'TASK_ANALYZER_V14_EVIDENCE' } } }] },
    select: taskSelect, orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }, { id: 'asc' }]
  });
}

type CommandTask = Awaited<ReturnType<typeof loadActionCandidates>>[number];

function activeAction(task: CommandTask): boolean {
  return isOpenAttentionTask(task) && attentionVerificationReasons(task).length === 0;
}

export async function loadCommandCenter(now = new Date()) {
  const current = workday(now);
  const checkpoint = await prisma.workdayBrief.findFirst({
    where: { completedAt: { not: null, lte: now } }, orderBy: { completedAt: 'desc' }, select: { completedAt: true }
  });
  const since = checkpoint?.completedAt ?? current.previousStart;
  const recentEventTypes = ['OBSERVED_STATUS_CHANGE', 'OBSERVED_DESCRIPTION_CHANGE', 'OBSERVED_DUEDATE_CHANGE', 'OBSERVED_ASSIGNEES_CHANGE'];
  const fallbackSelect = {
    ...taskSelect,
    comments: {
      where: { OR: [{ clickupCreatedAt: { gte: since } }, { clickupUpdatedAt: { gte: since } }] },
      orderBy: [{ clickupCreatedAt: 'desc' }, { id: 'desc' }], take: 1,
      select: { authorName: true, body: true, clickupCreatedAt: true, clickupUpdatedAt: true }
    },
    events: {
      where: { occurredAt: { gte: since }, eventType: { in: recentEventTypes } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1,
      select: { eventType: true, occurredAt: true }
    }
  } satisfies Prisma.TaskSelect;
  const openCurrentWhere: Prisma.TaskWhereInput = {
    deleted: false,
    client: { active: true, space: { name: 'JF Corporate' } },
    AND: [{ OR: [{ clickupStatus: null }, { NOT: { clickupStatus: { in: ['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled'], mode: 'insensitive' } } }] }]
  };
  const deadlineStart = new Date(now.getTime() - 2 * 86_400_000);
  const deadlineEnd = new Date(now.getTime() + 7 * 86_400_000);
  const corroborationStart = new Date(now.getTime() - 7 * 86_400_000);
  const newTaskStart = new Date(now.getTime() - 30 * 86_400_000);
  const [readiness, actionRows, updates, riskRows, reviews, brief, deadlineRows, activityRows] = await Promise.all([
    operationalReadiness(now),
    loadActionCandidates(now),
    prisma.operationalUpdate.findMany({
      where: { verified: true, OR: [
        { evidenceAt: { gte: since } },
        { evidenceAt: null, createdAt: { gte: since } }
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
    prisma.workdayBrief.findUnique({ where: { day: current.day } }),
    prisma.task.findMany({
      where: { AND: [openCurrentWhere, { dueDate: { gte: deadlineStart, lte: deadlineEnd } }, { OR: [
        { list: { type: 'AMI' } },
        { assignees: { some: { employee: { name: { equals: AMI_EMPLOYEE_NAME, mode: 'insensitive' } } } } }
      ] }, { OR: [
        { clickupCreatedAt: { gte: newTaskStart } },
        { comments: { some: { OR: [{ clickupCreatedAt: { gte: corroborationStart } }, { clickupUpdatedAt: { gte: corroborationStart } }] } } },
        { intelligence: { is: { classificationVersion: 'TASK_ANALYZER_V14_EVIDENCE', verificationStatus: 'VERIFIED', freshnessStatus: 'CURRENT' } } }
      ] }] },
      select: fallbackSelect, orderBy: [{ dueDate: 'asc' }, { clickupUpdatedAt: 'desc' }], take: 30
    }),
    prisma.task.findMany({
      where: { AND: [openCurrentWhere, { OR: [
        { comments: { some: { OR: [{ clickupCreatedAt: { gte: since } }, { clickupUpdatedAt: { gte: since } }] } } },
        { AND: [
          { clickupUpdatedAt: { gte: since } },
          { events: { some: { occurredAt: { gte: since }, eventType: { in: recentEventTypes } } } }
        ] }
      ] }] },
      select: fallbackSelect, orderBy: [{ clickupUpdatedAt: 'desc' }, { id: 'asc' }], take: 40
    })
  ]);
  const reviewed = new Set(reviews.map(item => item.itemKey));
  const actions = actionRows.filter(activeAction).map(task => {
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

  const representedTaskIds = new Set([...actionIds, ...changeItems.map(item => item.taskId), ...risks.map(item => item.id)]);
  const deadlineIds = new Set(deadlineRows.map(task => task.id));
  const fallbackRows = [...new Map([...activityRows, ...deadlineRows].map(task => [task.id, task])).values()];
  const eventLabels: Record<string, string> = {
    OBSERVED_STATUS_CHANGE: 'Status changed', OBSERVED_DESCRIPTION_CHANGE: 'Task details changed',
    OBSERVED_DUEDATE_CHANGE: 'Deadline changed', OBSERVED_ASSIGNEES_CHANGE: 'Assignment changed'
  };
  const checks = fallbackRows.filter(task => !representedTaskIds.has(task.id)).map(task => {
    const comment = task.comments[0];
    const event = task.events[0];
    const commentAt = Math.max(comment?.clickupCreatedAt?.getTime() ?? 0, comment?.clickupUpdatedAt?.getTime() ?? 0);
    const eventAt = event?.occurredAt?.getTime() ?? 0;
    const createdAt = task.clickupCreatedAt?.getTime() ?? 0;
    const dueAt = task.dueDate?.getTime() ?? 0;
    const deadline = deadlineIds.has(task.id) && dueAt > 0;
    let label: string, summary: string, sourceKind: string;
    let sourceAt: number, priority: number;
    if (commentAt >= eventAt && commentAt >= createdAt && comment) {
      label = 'Recent human comment';
      const body = comment.body.replace(/\s+/g, ' ').trim();
      summary = `${comment.authorName || 'A ClickUp user'}: ${body.slice(0, 180)}${body.length > 180 ? '…' : ''}`;
      sourceAt = commentAt;
      priority = 0;
      sourceKind = 'comment';
    } else if (eventAt >= createdAt && event) {
      label = eventLabels[event.eventType] ?? 'Observed ClickUp change';
      summary = 'ClickUp changed since the prior workday. Open the source details before deciding whether action is needed.';
      sourceAt = eventAt;
      priority = 1;
      sourceKind = 'event';
    } else if (deadline) {
      const assignees = task.assignees.map(item => item.employee.name).join(', ') || 'Ami';
      label = dueAt < now.getTime() ? 'Recently overdue' : dueAt <= now.getTime() + 2 * 86_400_000 ? 'Due within 2 days' : 'Upcoming Ami deadline';
      summary = `Assigned to ${assignees}. A recent source signal keeps this deadline in today’s check list.`;
      sourceAt = dueAt;
      priority = 3;
      sourceKind = 'due';
    } else return null;
    const fingerprint = `${sourceKind}-${new Date(sourceAt || now.getTime()).toISOString()}`;
    return { ...task, label, summary, sourceAt, priority, fingerprint, itemKey: briefItemKey('CHECK', task.id, fingerprint) };
  }).filter(item => item !== null).filter(item => !reviewed.has(item.itemKey)).sort((a, b) =>
    a.priority - b.priority || (a.priority < 3 ? b.sourceAt - a.sourceAt : a.sourceAt - b.sourceAt) || a.id - b.id);
  const groupedChecks = new Map<string, typeof checks[number]>();
  for (const check of checks) {
    const groupKey = `${check.clientId}:${clickupParentId(check.rawPayload) ?? check.clickupTaskId}`;
    if (!groupedChecks.has(groupKey)) groupedChecks.set(groupKey, check);
  }
  const visibleChecks = [...groupedChecks.values()];

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
    current, since, readiness, completedAt: brief?.completedAt ?? null,
    actions: visibleActions.slice(0, 3), actionTotal: visibleActions.length,
    changes: changeItems.slice(0, 5), changeTotal: changeItems.length,
    risks: risks.slice(0, 3), riskTotal: risks.length,
    checks: visibleChecks.slice(0, 3), checkTotal: visibleChecks.length,
    clients: clients.slice(0, 3), team: team.slice(0, 3), reviewedToday: reviews.length
  };
}
