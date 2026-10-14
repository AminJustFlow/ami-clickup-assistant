import { isStaleActive } from '@/lib/intelligence/staleness';
import { isOpenAttentionTask, isClosedClickUpStatus } from '@/lib/attention/triage';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';
import { CompactTaskSection } from '../../components/compact-task-list';
import { foldersForClient } from '@/lib/clients/grouping';

export const dynamic = 'force-dynamic';

type Filters = { assignee?: string; age?: string; due?: string; status?: string; q?: string; section?: string; page?: string };

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Filters>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();
  const allClientFolders = await prisma.client.findMany({
    where: { active: true, clickupSpaceId: client.clickupSpaceId },
    select: { id: true, slug: true, name: true, clickupFolderId: true }
  });
  const relatedFolders = foldersForClient(allClientFolders, slug);
  const tasks = await prisma.task.findMany({
    where: { clientId: { in: relatedFolders.map(folder => folder.id) }, deleted: false },
    select: {
      id: true, name: true, clickupStatus: true, clickupPriority: true,
      dueDate: true, clickupUpdatedAt: true, clickupUrl: true,
      client: { select: { name: true, slug: true } },
      intelligence: true,
      attentionDisposition: { select: { sourceFingerprint: true, decision: true } },
      list: { select: { name: true } },
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
      assignees: { select: { employee: { select: { id: true, name: true } } } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const assigneeOptions = [...new Map(tasks.flatMap(t => t.assignees.map(a =>
    [String(a.employee.id), { id: String(a.employee.id), name: a.employee.name }] as const
  ))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const statusOptions = [...new Set(tasks.map(t => t.clickupStatus).filter((s): s is string => Boolean(s)))].sort();
  const search = (filters.q ?? '').trim().toLowerCase();
  const now = new Date();
  const matches = (t: typeof tasks[number]) => {
    if (filters.due === 'overdue' && (isClosedClickUpStatus(t.clickupStatus) || !t.dueDate || t.dueDate >= now)) return false;
    if (search && ![t.name, t.list.name, t.intelligence?.currentSummary ?? '',
      t.intelligence?.amiAction ?? '', ...t.assignees.map(a => a.employee.name)]
      .some(value => value.toLowerCase().includes(search))) return false;
    if (filters.assignee && !t.assignees.some(a => String(a.employee.id) === filters.assignee)) return false;
    if (filters.status && (t.clickupStatus ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;
    const stale = isStaleActive({
      state: t.intelligence?.agentState ?? '',
      taskUpdatedAt: t.clickupUpdatedAt,
      commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt])
    });
    if (filters.age === '30' && !stale) return false;
    if (filters.age === 'recent' && stale) return false;
    return true;
  };
  const filtered = tasks.filter(matches);
  const needsAmi = filtered.filter(isOpenAttentionTask);
  const isClosed = (t: (typeof tasks)[number]) => t.intelligence?.agentState === 'COMPLETED' || isClosedClickUpStatus(t.clickupStatus);
  const waiting = filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) &&
    t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI');
  const inProgress = filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) &&
    !waiting.includes(t) && t.intelligence?.agentState === 'ACTIVE');
  const stale = inProgress.filter(t => isStaleActive({
    state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt,
    commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt])
  }));
  const recentlyActive = inProgress.filter(t => !stale.includes(t));
  const notStarted = filtered.filter(t => t.intelligence?.agentState === 'NOT_STARTED' && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const completed = filtered.filter(t => isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const unanalyzed = filtered.filter(t => !t.intelligence);
  const other = filtered.filter(t => t.intelligence && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t) && !inProgress.includes(t) && !notStarted.includes(t));
  const analyzedCount = tasks.filter(t => t.intelligence).length;
  const openCount = tasks.filter(t => !isClosedClickUpStatus(t.clickupStatus)).length;
  const overdueCount = tasks.filter(t => !isClosedClickUpStatus(t.clickupStatus) && t.dueDate && t.dueDate < now).length;
  const hasFilters = Boolean(filters.q || filters.assignee || filters.status || filters.age || filters.due);
  const currentNeedsAmi = tasks.filter(isOpenAttentionTask).length;
  const currentWaiting = tasks.filter(t => !isOpenAttentionTask(t) && !isClosedClickUpStatus(t.clickupStatus) && t.intelligence?.agentState !== 'COMPLETED' && t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI').length;
  const query = new URLSearchParams();
  for (const key of ['q', 'assignee', 'status', 'age', 'due'] as const) if (filters[key]) query.set(key, filters[key]);
  const sectionProps = { section: filters.section, page: filters.page, query: query.toString() };

  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="clients" />
    <header className="detail-hero"><div><a className="back-link" href="/clients">← All clients</a>
      <p className="eyebrow">CLIENT OVERVIEW</p><h1>{relatedFolders[0]?.name ?? client.name}</h1>
      <p>Find decisions, blockers, and current work without scrolling through full AI reports.</p></div></header>
    {relatedFolders.length > 1 && <details className="clean-panel compact-intel-folders"><summary>{relatedFolders.length} ClickUp folders consolidated into this client</summary><p>{relatedFolders.map(folder => folder.name).join(' · ')}</p></details>}
    <div className="detail-stat-strip client-detail-priority-stats">
      <div><strong>{currentNeedsAmi}</strong><span>Needs Ami decisions · all</span></div>
      <div><strong>{currentWaiting}</strong><span>Waiting on someone · all</span></div>
      <div><strong>{openCount}</strong><span>Open-status tasks · all</span></div>
      <div><strong>{overdueCount}</strong><span>Past due open tasks · all</span></div>
    </div>
    <p className="dashboard-note client-detail-context">{tasks.length.toLocaleString()} imported tasks · {analyzedCount.toLocaleString()} AI analyzed. Open and overdue counts include older imported tasks. These are status-based indicators, not verified current workload.</p>
    <nav className="client-detail-shortcuts" aria-label="Client work sections">
      <a href="#client-needs-ami">Needs Ami ({needsAmi.length})</a>
      <a href="#client-waiting">Waiting ({waiting.length})</a>
      <a href="#client-active">In progress ({recentlyActive.length})</a>
      <a href="#client-stale">Stale active ({stale.length})</a>
    </nav>
    {filters.due === 'overdue' && <p className="dashboard-note client-due-filter-notice">Showing open-status tasks past their due date. Older imported backlog may be included. <a href={`/clients/${encodeURIComponent(slug)}`}>Show all tasks →</a></p>}
    <form className="filter-bar clean-filters" method="GET">
      {filters.due === 'overdue' && <input type="hidden" name="due" value="overdue" />}
      <label className="search-label">Find a task<input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Search tasks, people, or summaries…" /></label>
      <label>Team member<select name="assignee" defaultValue={filters.assignee ?? ''}><option value="">Everyone</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>ClickUp status<select name="status" defaultValue={filters.status ?? ''}><option value="">Any status</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>Activity<select name="age" defaultValue={filters.age ?? ''}><option value="">Any time</option><option value="recent">Recently active</option><option value="30">Stale active</option></select></label>
      <button type="submit">Show results</button><a href={`/clients/${slug}`}>Clear filters</a>
    </form>
    <p className="filter-results">{filtered.length} of {tasks.length} imported tasks match.{hasFilters ? " Section counts reflect the current filters." : ""} {analyzedCount} of {tasks.length} have AI assessments; action categories do not cover unanalyzed tasks.</p>
    <div className="detail-sections compact-intel-sections">
      <div id="client-needs-ami"><CompactTaskSection title="Needs Ami" eyebrow="FIRST PRIORITY" tasks={needsAmi} sectionId="needs-ami" {...sectionProps} /></div>
      <div id="client-waiting"><CompactTaskSection title="Waiting on someone" eyebrow="DEPENDENCIES" tasks={waiting} sectionId="waiting" {...sectionProps} /></div>
      <div id="client-active"><CompactTaskSection title="Recently active" eyebrow="IN PROGRESS" tasks={recentlyActive} sectionId="active" {...sectionProps} /></div>
      <div id="client-stale"><CompactTaskSection title="Stale active" tasks={stale} sectionId="stale" collapsed {...sectionProps} /></div>
      <CompactTaskSection title="Not started" tasks={notStarted} sectionId="not-started" collapsed {...sectionProps} />
      <CompactTaskSection title="Other analyzed tasks" tasks={other} sectionId="other" collapsed {...sectionProps} />
      <CompactTaskSection title="Completed" tasks={completed} sectionId="completed" collapsed {...sectionProps} />
      <CompactTaskSection title="Awaiting AI analysis" tasks={unanalyzed} sectionId="unanalyzed" collapsed {...sectionProps} />
    </div>
  </main>;
}
