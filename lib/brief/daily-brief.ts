import { groupClientFolders, type ClientFolder } from '@/lib/clients/grouping';
import { isOpenAttentionTask } from '@/lib/attention/triage';
import { isStaleActive, lastSourceActivity } from '@/lib/intelligence/staleness';

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
};

export type BriefChange = BriefTask & { changedAt: Date; kind: 'RISK' | 'PROGRESS' };

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
  decisions: BriefTask[];
  newRisks: BriefChange[];
  progress: BriefChange[];
  clients: ClientBrief[];
  totals: { decisions: number; overdue: number; blocked: number; stale: number; externalDependencies: number; completedSince: number };
};

export type BriefTaskInput = {
  id: number;
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

function rank(priority: BriefPriority): number {
  return ({ OVERDUE_DECISION: 0, HIGH_RISK: 1, AMI_DECISION: 2, STALE: 3, DEPENDENCY: 4, RECENT: 5 })[priority];
}

export function compareBriefTasks(a: BriefTask, b: BriefTask): number {
  return rank(a.priority) - rank(b.priority)
    || b.attentionScore - a.attentionScore
    || (b.evidenceAt?.getTime() ?? 0) - (a.evidenceAt?.getTime() ?? 0)
    || a.name.localeCompare(b.name);
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
    const openDecision = isOpenAttentionTask({
      clickupStatus: task.clickupStatus,
      intelligence: intel ? { needsAmi: intel.needsAmi, agentState: intel.agentState, sourceFingerprint: intel.sourceFingerprint, analyzedAt: intel.analyzedAt } : null,
      attentionDisposition: task.attentionDisposition
    });
    const highRisk = !closed(task.clickupStatus) && (intel?.riskLevel === 'CRITICAL' || intel?.riskLevel === 'HIGH' || intel?.agentState === 'BLOCKED' || intel?.agentState === 'ISSUE');
    const stale = !!intel && isStaleActive({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }, now);
    const dependency = !!intel && ['WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR'].includes(intel.agentState);
    const priority: BriefPriority = openDecision && overdue ? 'OVERDUE_DECISION' : highRisk ? 'HIGH_RISK' : openDecision ? 'AMI_DECISION' : stale ? 'STALE' : dependency ? 'DEPENDENCY' : 'RECENT';
    return {
      id: task.id, name: task.name, clientName: group?.canonical.name ?? 'Unattributed client', clientSlug: group?.canonical.slug ?? '',
      clickupUrl: task.clickupUrl, clickupStatus: task.clickupStatus, dueDate: task.dueDate, clickupUpdatedAt: task.clickupUpdatedAt,
      evidenceAt: intel?.lastMeaningfulChangeAt ?? activity, analyzedAt: intel?.analyzedAt ?? null,
      summary: intel?.currentSummary ?? null, action: intel?.amiAction ?? null, state: intel?.agentState ?? null, risk: intel?.riskLevel ?? null,
      waitingOnType: intel?.waitingOnType ?? null, waitingOnName: intel?.waitingOnName ?? null,
      attentionScore: intel?.amiAttentionScore ?? 0, priority, overdue
    };
  };

  const briefById = new Map(sourceTasks.map(task => [task.id, toBriefTask(task)]));
  const openDecisions = sourceTasks.filter(task => isOpenAttentionTask({
    clickupStatus: task.clickupStatus,
    intelligence: task.intelligence ? { needsAmi: task.intelligence.needsAmi, agentState: task.intelligence.agentState, sourceFingerprint: task.intelligence.sourceFingerprint, analyzedAt: task.intelligence.analyzedAt } : null,
    attentionDisposition: task.attentionDisposition
  })).map(task => briefById.get(task.id)!).sort(compareBriefTasks);

  const activeRisks = sourceTasks.filter(task => {
    const intel = task.intelligence;
    return intel && !closed(task.clickupStatus) && intel.agentState !== 'COMPLETED' &&
      (['CRITICAL', 'HIGH'].includes(intel.riskLevel) || ['BLOCKED', 'ISSUE'].includes(intel.agentState));
  });
  const recentRisks = activeRisks.filter(task => {
    const intel = task.intelligence!;
    return (intel.lastMeaningfulChangeAt?.getTime() ?? 0) >= since.getTime()
      || (intel.analyzedAt?.getTime() ?? 0) >= since.getTime()
      || (changesByTask.get(task.id) ?? []).some(change => change.detectedAt >= since);
  }).map(task => ({ ...briefById.get(task.id)!, changedAt: task.intelligence!.lastMeaningfulChangeAt ?? task.intelligence!.analyzedAt ?? now, kind: 'RISK' as const }))
    .sort((a, b) => compareBriefTasks(a, b));

  const completed = sourceTasks.filter(task => {
    const intel = task.intelligence;
    if (!intel || intel.agentState !== 'COMPLETED') return false;
    return (intel.lastMeaningfulChangeAt?.getTime() ?? 0) >= since.getTime()
      || (changesByTask.get(task.id) ?? []).some(change => change.nextState === 'COMPLETED' && change.detectedAt >= since);
  }).map(task => {
    const changeDate = (changesByTask.get(task.id) ?? []).filter(change => change.nextState === 'COMPLETED').sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())[0]?.detectedAt;
    return { ...briefById.get(task.id)!, changedAt: changeDate ?? task.intelligence!.lastMeaningfulChangeAt ?? task.clickupUpdatedAt ?? now, kind: 'PROGRESS' as const };
  }).sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  const clients: ClientBrief[] = groups.map(group => {
    const folderIds = new Set(group.folders.map(folder => folder.id));
    const tasks = sourceTasks.filter(task => folderIds.has(task.clientId));
    const analyzed = tasks.filter(task => task.intelligence).length;
    const decisions = openDecisions.filter(task => folderIds.has(sourceTasks.find(source => source.id === task.id)!.clientId));
    const risks = activeRisks.filter(task => folderIds.has(task.clientId)).map(task => briefById.get(task.id)!).sort(compareBriefTasks);
    const dependencies = tasks.filter(task => task.intelligence && !closed(task.clickupStatus) && ['WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR'].includes(task.intelligence.agentState)).map(task => briefById.get(task.id)!).sort(compareBriefTasks);
    const progress = completed.filter(task => folderIds.has(sourceTasks.find(source => source.id === task.id)!.clientId));
    const overdue = tasks.filter(task => briefById.get(task.id)!.overdue).length;
    const blocked = risks.filter(task => task.state === 'BLOCKED' || task.state === 'ISSUE').length;
    const urgency = decisions.filter(task => task.overdue).length * 1000 + decisions.length * 100 + risks.length * 25 + overdue * 10 + dependencies.length;
    return { slug: group.canonical.slug, name: group.canonical.name, imported: tasks.length, analyzed, decisions, risks, dependencies, progress, overdue, blocked, urgency, healthy: decisions.length === 0 && risks.length === 0 && overdue === 0 };
  }).sort((a, b) => b.urgency - a.urgency || a.name.localeCompare(b.name));

  const analyzed = sourceTasks.filter(task => task.intelligence).length;
  const syncDates = input.clients.map(client => client.lastSyncedAt).filter((date): date is Date => !!date);
  const oldestSyncAt = syncDates.length ? new Date(Math.min(...syncDates.map(date => date.getTime()))) : null;
  const staleClientCount = input.clients.filter(client => !client.lastSyncedAt || client.lastSyncedAt < new Date(now.getTime() - 30 * 60_000)).length;
  const allBriefTasks = [...briefById.values()];
  return {
    generatedAt: now, since, decisions: openDecisions, newRisks: recentRisks, progress: completed, clients,
    coverage: { imported: sourceTasks.length, analyzed, percent: sourceTasks.length ? Math.round(analyzed / sourceTasks.length * 100) : 0, oldestSyncAt, staleClientCount },
    totals: {
      decisions: openDecisions.length,
      overdue: allBriefTasks.filter(task => task.overdue).length,
      blocked: activeRisks.filter(task => ['BLOCKED', 'ISSUE'].includes(task.intelligence!.agentState)).length,
      stale: sourceTasks.filter(task => task.intelligence && isStaleActive({ state: task.intelligence.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }, now)).length,
      externalDependencies: allBriefTasks.filter(task => ['TEAM', 'CLIENT', 'VENDOR'].includes(task.waitingOnType ?? '') && task.state !== 'COMPLETED' && !closed(task.clickupStatus)).length,
      completedSince: completed.length
    }
  };
}
