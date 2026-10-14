import { prisma } from '@/lib/db/prisma';
import { groupClientFolders, needsClientAttribution } from '@/lib/clients/grouping';
import { isClosedClickUpStatus, isOpenAttentionTask } from '@/lib/attention/triage';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

type Filters = { q?: string; sort?: string; focus?: string };
type PortfolioEntry = {
  slug: string; name: string; imported: number; active: number; overdue: number;
  needsAmi: number; latestActivity: Date | null; recentEvent: { date: Date; task: string; folderName: string; type: string } | null;
};
const validSorts = ['name', 'active', 'overdue', 'attention', 'recent', 'tasks'];
const validFocus = ['all', 'attention', 'overdue', 'active'];
function formatActivity(value: Date | null) {
  return value ? value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No activity date';
}

export default async function ClientsDirectory({ searchParams }: { searchParams: Promise<Filters> }) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().slice(0, 120);
  const sort = validSorts.includes(params.sort ?? '') ? params.sort! : 'name';
  const focus = validFocus.includes(params.focus ?? '') ? params.focus! : 'all';
  const now = new Date();
  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, name: true, slug: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders).filter(group => !needsClientAttribution(group.canonical.name));
  const scope = { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } as const;
  const activitySince = new Date(now.getTime() - 30 * 86400000);
  const [counts, tasks, attentionCandidates, recentComments, recentEvents] = await Promise.all([
    prisma.task.groupBy({
      by: ['clientId'], where: scope,
      _count: { _all: true },
      _max: { clickupUpdatedAt: true }
    }),
    prisma.task.findMany({
      where: scope,
      select: { clientId: true, clickupStatus: true, dueDate: true }
    }),
    prisma.task.findMany({
      where: { ...scope, intelligence: { is: { needsAmi: true } } },
      select: {
        clientId: true, clickupStatus: true,
        intelligence: { select: { needsAmi: true, agentState: true, sourceFingerprint: true, analyzedAt: true } },
        attentionDisposition: { select: { decision: true, sourceFingerprint: true } }
      }
    }),
    prisma.comment.findMany({ where: { clickupCreatedAt: { gte: activitySince }, task: scope }, select: { clickupCreatedAt: true, task: { select: { clientId: true, name: true } } }, orderBy: { clickupCreatedAt: 'desc' }, take: 1000 }),
    prisma.taskEvent.findMany({ where: { occurredAt: { gte: activitySince }, task: scope }, select: { occurredAt: true, task: { select: { clientId: true, name: true } } }, orderBy: { occurredAt: 'desc' }, take: 1000 })
  ]);
  const folderNameById = new Map(folders.map(folder => [folder.id, folder.name]));
  const activityById = new Map<number, { date: Date; task: string; folderName: string; type: string }>();
  const recordActivity = (clientId: number, date: Date | null, task: string, type: string) => {
    if (!date || (activityById.get(clientId)?.date.getTime() ?? 0) >= date.getTime()) return;
    activityById.set(clientId, { date, task, folderName: folderNameById.get(clientId) ?? '', type });
  };
  for (const item of recentComments) recordActivity(item.task.clientId, item.clickupCreatedAt, item.task.name, 'Comment');
  for (const item of recentEvents) if (item.task) recordActivity(item.task.clientId, item.occurredAt, item.task.name, 'Task change');
  const importedById = new Map(counts.map(row => [row.clientId, row._count._all]));
  const latestById = new Map(counts.map(row => [row.clientId, row._max.clickupUpdatedAt]));
  const activeById = new Map<number, number>();
  const overdueById = new Map<number, number>();
  for (const task of tasks) {
    if (isClosedClickUpStatus(task.clickupStatus)) continue;
    activeById.set(task.clientId, (activeById.get(task.clientId) ?? 0) + 1);
    if (task.dueDate && task.dueDate < now) overdueById.set(task.clientId, (overdueById.get(task.clientId) ?? 0) + 1);
  }
  const attentionById = new Map<number, number>();
  for (const task of attentionCandidates) {
    if (!isOpenAttentionTask(task)) continue;
    attentionById.set(task.clientId, (attentionById.get(task.clientId) ?? 0) + 1);
  }
  const entries: PortfolioEntry[] = groups.map(group => {
    const ids = group.folders.map(folder => folder.id);
    const latest = ids.map(id => latestById.get(id)).filter((date): date is Date => !!date);
    return {
      slug: group.canonical.slug, name: group.canonical.name,
      imported: ids.reduce((sum, id) => sum + (importedById.get(id) ?? 0), 0),
      active: ids.reduce((sum, id) => sum + (activeById.get(id) ?? 0), 0),
      overdue: ids.reduce((sum, id) => sum + (overdueById.get(id) ?? 0), 0),
      needsAmi: ids.reduce((sum, id) => sum + (attentionById.get(id) ?? 0), 0),
      latestActivity: latest.length ? new Date(Math.max(...latest.map(date => date.getTime()))) : null,
      recentEvent: ids.map(id => activityById.get(id)).filter((value): value is NonNullable<typeof value> => !!value).sort((a,b) => b.date.getTime() - a.date.getTime())[0] ?? null
    };
  });
  const search = q.toLowerCase();
  const filtered = entries.filter(entry =>
    (!search || entry.name.toLowerCase().includes(search)) &&
    (focus === 'all' || (focus === 'attention' && entry.needsAmi > 0) ||
      (focus === 'overdue' && entry.overdue > 0) || (focus === 'active' && entry.active > 0))
  ).sort((a, b) => {
    const difference = sort === 'tasks' ? b.imported - a.imported :
      sort === 'active' ? b.active - a.active :
      sort === 'overdue' ? b.overdue - a.overdue :
      sort === 'attention' ? b.needsAmi - a.needsAmi :
      sort === 'recent' ? (b.latestActivity?.getTime() ?? 0) - (a.latestActivity?.getTime() ?? 0) : 0;
    return difference || a.name.localeCompare(b.name);
  });
  const totalActive = entries.reduce((sum, entry) => sum + entry.active, 0);
  const totalOverdue = entries.reduce((sum, entry) => sum + entry.overdue, 0);
  const totalAttention = entries.reduce((sum, entry) => sum + entry.needsAmi, 0);
  return <main className="ops-shell dashboard-shell clients-portfolio" id="main-content">
    <AppNav current="clients" />
    <header className="detail-hero"><p className="eyebrow">CLIENT PORTFOLIO</p><h1>All clients</h1>
      <p>Find client work, open decisions and overdue tasks. Historical imported tasks are shown separately.</p></header>
    <section className="detail-stat-strip client-portfolio-stats" aria-label="Client portfolio overview">
      <div><strong>{entries.length}</strong><span>Client accounts</span></div>
      <div><strong>{totalActive.toLocaleString()}</strong><span>Open-status tasks</span></div>
      <div><strong>{totalOverdue.toLocaleString()}</strong><span>Open tasks past due</span></div>
      <div><strong>{totalAttention.toLocaleString()}</strong><span>Open Needs Ami decisions</span></div>
    </section>
    <p className="dashboard-note">Open-status tasks exclude recognized completed, closed and canceled statuses. Past-due counts are unverified backlog, not a measure of current employee performance: open-status tasks with historical due dates may still count. Needs Ami uses current, unreviewed AI recommendations.</p>
    <section className="clean-panel directory-panel">
      <div className="panel-heading"><div><h2>Client accounts</h2><p>Related ClickUp folders appear under one client.</p></div>
        <span className="panel-count">{entries.length}</span></div>
      <form className="filter-bar clean-filters directory-filters client-portfolio-filters" method="GET">
        <label className="search-label">Search clients<input type="search" name="q" defaultValue={q} placeholder="Client name…" /></label>
        <label>Show<select name="focus" defaultValue={focus}>
          <option value="all">All clients</option><option value="attention">Needs Ami</option>
          <option value="overdue">Has overdue tasks</option><option value="active">Has open tasks</option>
        </select></label>
        <label>Sort by<select name="sort" defaultValue={sort}>
          <option value="name">Client name</option><option value="attention">Most Needs Ami</option>
          <option value="overdue">Most overdue</option><option value="active">Most open tasks</option>
          <option value="recent">Most recently updated</option><option value="tasks">Most imported tasks</option>
        </select></label>
        <button type="submit">Apply</button><a href="/clients">Clear</a>
      </form>
      <p className="directory-result-count">{filtered.length} of {entries.length} clients · Workload counts are separate from historical imported totals.</p>
      <div className="directory-grid">{filtered.map(entry => <div className="directory-entry client-portfolio-entry" key={entry.slug}>
        <span className="entity-avatar">{entry.name[0]?.toUpperCase() ?? '?'}</span>
        <span className="client-portfolio-info">
          <a className="client-portfolio-name" href={`/clients/${encodeURIComponent(entry.slug)}`}><strong>{entry.name}</strong></a>
          <small>{entry.imported.toLocaleString()} imported · Updated {formatActivity(entry.latestActivity)}</small>
          <span className="client-portfolio-metrics">
            <span>{entry.active.toLocaleString()} open</span>
            <span className={entry.overdue ? 'client-portfolio-overdue' : ''}>{entry.overdue.toLocaleString()} overdue</span>
            <span className={entry.needsAmi ? 'client-portfolio-attention' : ''}>{entry.needsAmi.toLocaleString()} Needs Ami</span>
          </span>
          {entry.recentEvent && <span className="client-portfolio-activity"><span>{entry.recentEvent.type} · {formatActivity(entry.recentEvent.date)} · {entry.recentEvent.task}</span> <a href={`/changes?client=${encodeURIComponent(entry.recentEvent.folderName)}&range=30`}>View activity →</a></span>}
        </span>
        <a className="client-portfolio-open" href={`/clients/${encodeURIComponent(entry.slug)}`} aria-label={`Open ${entry.name}`}>↗</a></div>)}
      </div>
      {filtered.length === 0 && <p className="simple-empty directory-empty">No clients match these filters.</p>}
    </section>
  </main>;
}
