import { groupClientFolders, type ClientFolder } from '@/lib/clients/grouping';
import { isOpenAttentionTask } from '@/lib/attention/triage';
import { isStaleActive, lastSourceActivity } from '@/lib/intelligence/staleness';
import { groupTaskInsights } from '@/lib/tasks/insight-groups';
import { compareRecentFirst } from '@/lib/tasks/recency';

export const DAILY_BRIEF_COOKIE = 'ami_daily_brief_last_reviewed';
export const DAY_MS = 86_400_000;

export type BriefPriority = 'OVERDUE_DECISION' | 'HIGH_RISK' | 'AMI_DECISION' | 'STALE' | 'DEPENDENCY' | 'RECENT';

export type BriefTask = {
  id: number;
  name: string;
  clientName: string;
  clientSlug: string;
  clickupUrl: string | null;
  clickupStatus: string | null;
  dueDate: Date | null;
  clickupUpdatedAt: Date | null;
  evidenceAt: Date | null;
  analyzedAt: Date | null;
  summary: string | null;
  action: string | null;
  state: string | null;
  risk: string | null;
  waitingOnType: string | null;
  waitingOnName: string | null;
  attentionScore: number;
  priority: BriefPriority;
  overdue: boolean;
  groupActivityAt?: Date | null;
  relatedInsights?: BriefTask[];
};

export type BriefChange = BriefTask & { changedAt: Date; kind: 'RISK' | 'PROGRESS' };
export type TopAction = BriefTask & { actionKind: 'DECISION' | 'INTERVENTION'; actionReason: string };

export type BriefCoverage = {
  imported: number;
  analyzed: number;
  percent: number;
  oldestSyncAt: Date | null;
  staleClientCount: number;
};

export type ClientBrief = {
  slug: string;
  name: string;
  imported: number;
  analyzed: number;
  decisions: BriefTask[];
  risks: BriefTask[];
  dependencies: BriefTask[];
  progress: BriefTask[];
  overdue: number;
  blocked: number;
  urgency: number;
  healthy: boolean;
};

export type DailyBrief = {
  generatedAt: Date;
  since: Date;
  coverage: BriefCoverage;
  topActions: TopAction[];
  decisions: BriefTask[];
  newRisks: BriefChange[];
  progress: BriefChange[];
  clients: ClientBrief[];
  totals: { decisions: number; overdue: number; overdueRecent: number; overdueOlder: number; blocked: number; stale: number; externalDependencies: number; completedSince: number };
};

export type BriefTaskInput = {
  id: number;
  clickupTaskId: string;
  rawPayload: unknown;
  name: string;
  clientId: number;
  clickupUrl: string | null;
  clickupStatus: string | null;
  dueDate: Date | null;
  clickupUpdatedAt: Date | null;
  deleted: boolean;
  comments: { clickupCreatedAt: Date | null; clickupUpdatedAt: Date | null }[];
  attentionDisposition: { sourceFingerprint: string; decision: string } | null;
  intelligence: null | {
    agentState: string;
    needsAmi: boolean;
    amiAction: string | null;
    currentSummary: string | null;
    waitingOnType: string;
    waitingOnName: string | null;
    importanceScore: number;
    amiAttentionScore: number;
    riskLevel: string;
    lastMeaningfulChange: string | null;
    lastMeaningfulChangeAt: Date | null;
    sourceFingerprint: string | null;
    analyzedAt: Date | null;
    verificationStatus?: string | null;
    classificationVersion?: string | null;
  };
};

export type BriefChangeInput = { taskId: number; nextState: string; nextNeedsAmi: boolean; detectedAt: Date };
export type BriefClientInput = ClientFolder & { lastSyncedAt: Date | null };

export function briefSince(raw: string | undefined, now = new Date()): Date {
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() <= now.getTime()) return parsed;
  }
  return new Date(now.getTime() - DAY_MS);
}

export function formatEastern(value: Date): string {
  return value.toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
}

const closed = (status: string | null) => /^(done|complete|completed|closed|cancelled|canceled)$/i.test(status?.trim() ?? '');
const evidenceVerified = (task: BriefTaskInput) => task.intelligence?.verificationStatus === 'VERIFIED';

export function compareBriefTasks(a: BriefTask, b: BriefTask): number {
  return compareRecentFirst(
    { id: a.id, clickupUpdatedAt: a.groupActivityAt ?? a.clickupUpdatedAt, intelligence: { lastMeaningfulChangeAt: a.groupActivityAt ?? a.evidenceAt } },
    { id: b.id, clickupUpdatedAt: b.groupActivityAt ?? b.clickupUpdatedAt, intelligence: { lastMeaningfulChangeAt: b.groupActivityAt ?? b.evidenceAt } }
  );
}

export function buildDailyBrief(input: {
  now: Date;
  since: Date;
  clients: BriefClientInput[];
  tasks: BriefTaskInput[];
  changes: BriefChangeInput[];
}): DailyBrief {
  const { now, since } = input;
  const groups = groupClientFolders(input.clients);
  const groupByFolder = new Map(groups.flatMap(group => group.folders.map(folder => [folder.id, group] as const)));
  const sourceTasks = input.tasks.filter(task => !task.deleted);
  const changesByTask = new Map<number, BriefChangeInput[]>();
  for (const change of input.changes) changesByTask.set(change.taskId, [...(changesByTask.get(change.taskId) ?? []), change]);

  const toBriefTask = (task: BriefTaskInput): BriefTask => {
    const intel = task.intelligence;
    const group = groupByFolder.get(task.clientId);
    const activity = lastSourceActivity({
      state: intel?.agentState ?? 'UNKNOWN', taskUpdatedAt: task.clickupUpdatedAt,
      commentDates: task.comments.flatMap(comment => [comment.clickupCreatedAt, comment.clickupUpdatedAt])
    });
    const overdue = !!task.dueDate && task.dueDate < now && !closed(task.clickupStatus) && intel?.agentState !== 'COMPLETED';
    const openDecision = evidenceVerified(task) && isOpenAttentionTask({
      clickupStatus: task.clickupStatus,
      intelligence: intel ? { needsAmi: intel.needsAmi, agentState: intel.agentState, sourceFingerprint: intel.sourceFingerprint, analyzedAt: intel.analyzedAt } : null,
      attentionDisposition: task.attentionDisposition
    });
    const highRisk = !closed(task.clickupStatus) && (intel?.riskLevel === 'CRITICAL' || intel?.riskLevel === 'HIGH' || intel?.agentState === 'BLOCKED' || intel?.agentState === 'ISSUE');
    const stale = !!intel && isStaleActive({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }, now);
    const dependency = !!intel && ['WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR'].includes(intel.agentState);
    const priority: BriefPriority = openDecision && overdue ? 'OVERDUE_DECISION' : highRisk ? 'HIGH_RISK' : openDecision ? 'AMI_DECISION' : stale ? 'STALE' : dependency ? 'DEPENDENCY' : 'RECENT';
    const evidenceTime = Math.max(intel?.lastMeaningfulChangeAt?.getTime() ?? 0, activity?.getTime() ?? 0);
    return {
      id: task.id, name: task.name, clientName: group?.canonical.name ?? 'Unattributed client', clientSlug: group?.canonical.slug ?? '',
      clickupUrl: task.clickupUrl, clickupStatus: task.clickupStatus, dueDate: task.dueDate, clickupUpdatedAt: task.clickupUpdatedAt,
      evidenceAt: evidenceTime ? new Date(evidenceTime) : null, analyzedAt: intel?.analyzedAt ?? null,
      summary: intel?.currentSummary ?? null, action: intel?.amiAction ?? null, state: intel?.agentState ?? null, risk: intel?.riskLevel ?? null,
      waitingOnType: intel?.waitingOnType ?? null, waitingOnName: intel?.waitingOnName ?? null,
      attentionScore: intel?.amiAttentionScore ?? 0, priority, overdue
    };
  };

  const briefById = new Map(sourceTasks.map(task => [task.id, toBriefTask(task)]));
  const groupBrief = (matches: BriefTaskInput[]) => groupTaskInsights(sourceTasks, matches, (a, b) =>
    compareBriefTasks(briefById.get(a.id)!, briefById.get(b.id)!)).map(group => {
      const memberBriefs = group.members.map(member => briefById.get(member.id)!);
      const groupActivityTime = Math.max(...memberBriefs.map(member => Math.max(member.evidenceAt?.getTime() ?? 0, member.clickupUpdatedAt?.getTime() ?? 0)));
      return {
        ...briefById.get(group.primary.id)!, groupActivityAt: groupActivityTime ? new Date(groupActivityTime) : null,
        relatedInsights: group.members.filter(member => member.id !== group.primary.id).map(member => briefById.get(member.id)!)
      };
    });
  const openDecisions = groupBrief(sourceTasks.filter(task => evidenceVerified(task) && isOpenAttentionTask({
    clickupStatus: task.clickupStatus,
    intelligence: task.intelligence ? { needsAmi: task.intelligence.needsAmi, agentState: task.intelligence.agentState, sourceFingerprint: task.intelligence.sourceFingerprint, analyzedAt: task.intelligence.analyzedAt } : null,
    attentionDisposition: task.attentionDisposition
  }))).sort(compareBriefTasks);

  const activeRisks = sourceTasks.filter(task => {
    const intel = task.intelligence;
    return intel && !closed(task.clickupStatus) && intel.agentState !== 'COMPLETED' &&
      (['CRITICAL', 'HIGH'].includes(intel.riskLevel) || ['BLOCKED', 'ISSUE'].includes(intel.agentState));
  });
  const recentRiskTasks = activeRisks.filter(task => {
    const intel = task.intelligence!;
    return (intel.lastMeaningfulChangeAt?.getTime() ?? 0) >= since.getTime()
      || (intel.analyzedAt?.getTime() ?? 0) >= since.getTime()
      || (changesByTask.get(task.id) ?? []).some(change => change.detectedAt >= since);
  });
  const recentRisks = groupBrief(recentRiskTasks).map(task => ({
    ...task, changedAt: task.groupActivityAt ?? task.evidenceAt ?? task.analyzedAt ?? now, kind: 'RISK' as const
  })).sort((a, b) => compareBriefTasks(a, b));

  const completedTasks = sourceTasks.filter(task => {
    const intel = task.intelligence;
    if (!intel || intel.agentState !== 'COMPLETED') return false;
    return (intel.lastMeaningfulChangeAt?.getTime() ?? 0) >= since.getTime()
      || (changesByTask.get(task.id) ?? []).some(change => change.nextState === 'COMPLETED' && change.detectedAt >= since);
  });
  const completed = groupBrief(completedTasks).map(task => {
    const changeDate = (changesByTask.get(task.id) ?? []).filter(change => change.nextState === 'COMPLETED').sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())[0]?.detectedAt;
    return { ...task, changedAt: task.groupActivityAt ?? changeDate ?? task.evidenceAt ?? task.clickupUpdatedAt ?? now, kind: 'PROGRESS' as const };
  }).sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  const clients: ClientBrief[] = groups.map(group => {
    const folderIds = new Set(group.folders.map(folder => folder.id));
    const tasks = sourceTasks.filter(task => folderIds.has(task.clientId));
    const analyzed = tasks.filter(task => task.intelligence).length;
    const decisions = openDecisions.filter(task => folderIds.has(sourceTasks.find(source => source.id === task.id)!.clientId));
    const risks = groupBrief(activeRisks.filter(task => folderIds.has(task.clientId))).sort(compareBriefTasks);
    const dependencies = groupBrief(tasks.filter(task => task.intelligence && !closed(task.clickupStatus) && ['WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR'].includes(task.intelligence.agentState))).sort(compareBriefTasks);
    const progress = completed.filter(task => folderIds.has(sourceTasks.find(source => source.id === task.id)!.clientId));
    const overdue = groupTaskInsights(sourceTasks, tasks.filter(task => briefById.get(task.id)!.overdue)).length;
    const blocked = risks.filter(task => task.state === 'BLOCKED' || task.state === 'ISSUE').length;
    const urgency = decisions.filter(task => task.overdue).length * 1000 + decisions.length * 100 + risks.length * 25 + overdue * 10 + dependencies.length;
    return { slug: group.canonical.slug, name: group.canonical.name, imported: tasks.length, analyzed, decisions, risks, dependencies, progress, overdue, blocked, urgency, healthy: decisions.length === 0 && risks.length === 0 && overdue === 0 };
  }).sort((a, b) => b.urgency - a.urgency || a.name.localeCompare(b.name));

  const analyzed = sourceTasks.filter(task => task.intelligence).length;
  const syncDates = input.clients.map(client => client.lastSyncedAt).filter((date): date is Date => !!date);
  const oldestSyncAt = syncDates.length ? new Date(Math.min(...syncDates.map(date => date.getTime()))) : null;
  const staleClientCount = input.clients.filter(client => !client.lastSyncedAt || client.lastSyncedAt < new Date(now.getTime() - 30 * 60_000)).length;
  const hierarchyKeyByTaskId = new Map<number, string>();
  for (const group of groupTaskInsights(sourceTasks, sourceTasks)) for (const member of group.members) hierarchyKeyByTaskId.set(member.id, group.groupKey);
  const decisionGroupKeys = new Set(openDecisions.map(task => hierarchyKeyByTaskId.get(task.id) ?? String(task.id)));
  const interventions = groupBrief(activeRisks).filter(task => !decisionGroupKeys.has(hierarchyKeyByTaskId.get(task.id) ?? String(task.id)));
  const topActions: TopAction[] = [
    ...openDecisions.map(task => ({ ...task, actionKind: 'DECISION' as const, actionReason: task.overdue ? 'A concrete decision is waiting and its due date has passed.' : 'A concrete response or decision is waiting for Ami.' })),
    ...interventions.map(task => ({ ...task, actionKind: 'INTERVENTION' as const, actionReason: task.state === 'BLOCKED' ? 'Work is blocked and may need management intervention.' : 'This work has a current high-risk or issue signal.' }))
  ].sort(compareBriefTasks).slice(0, 3);
  const overdueTasks = sourceTasks.filter(task => briefById.get(task.id)!.overdue);
  const overdueGroups = groupTaskInsights(sourceTasks, overdueTasks);
  const overdueRecent = overdueGroups.filter(group => group.members.some(task => task.clickupUpdatedAt && now.getTime() - task.clickupUpdatedAt.getTime() <= 30 * DAY_MS)).length;
  return {
    generatedAt: now, since, topActions, decisions: openDecisions, newRisks: recentRisks, progress: completed, clients,
    coverage: { imported: sourceTasks.length, analyzed, percent: sourceTasks.length ? Math.round(analyzed / sourceTasks.length * 100) : 0, oldestSyncAt, staleClientCount },
    totals: {
      decisions: openDecisions.length,
      overdue: overdueGroups.length,
      overdueRecent,
      overdueOlder: overdueGroups.length - overdueRecent,
      blocked: groupTaskInsights(sourceTasks, activeRisks.filter(task => ['BLOCKED', 'ISSUE'].includes(task.intelligence!.agentState))).length,
      stale: groupTaskInsights(sourceTasks, sourceTasks.filter(task => task.intelligence && isStaleActive({ state: task.intelligence.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }, now))).length,
      externalDependencies: groupTaskInsights(sourceTasks, sourceTasks.filter(task => ['TEAM', 'CLIENT', 'VENDOR'].includes(task.intelligence?.waitingOnType ?? '') && task.intelligence?.agentState !== 'COMPLETED' && !closed(task.clickupStatus))).length,
      completedSince: completed.length
    }
  };
}
