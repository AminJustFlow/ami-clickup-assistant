import { isStaleActive } from '@/lib/intelligence/staleness';
import { isOpenAttentionTask, isClosedClickUpStatus } from '@/lib/attention/triage';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';
import { CompactTaskSection } from '../../components/compact-task-list';
import { foldersForClient } from '@/lib/clients/grouping';

export const dynamic = 'force-dynamic';

type Filters = { assignee?: string; age?: string; status?: string; q?: string; section?: string; page?: string };

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
    include: {
      client: { select: { name: true } }, intelligence: true, attentionDisposition: true, list: true,
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
      assignees: { include: { employee: true } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const assigneeOptions = [...new Map(tasks.flatMap(t => t.assignees.map(a =>
    [String(a.employee.id), { id: String(a.employee.id), name: a.employee.name }] as const
  ))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const statusOptions = [...new Set(tasks.map(t => t.clickupStatus).filter((s): s is string => Boolean(s)))].sort();
  const search = (filters.q ?? '').trim().toLowerCase();
  const matches = (t: typeof tasks[number]) => {
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
  const query = new URLSearchParams();
  for (const key of ['q', 'assignee', 'status', 'age'] as const) if (filters[key]) query.set(key, filters[key]);
  const sectionProps = { section: filters.section, page: filters.page, query: query.toString() };

  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="clients" />
    <header className="detail-hero"><div><a className="back-link" href="/#clients">← All clients</a>
      <p className="eyebrow">CLIENT OVERVIEW</p><h1>{relatedFolders[0]?.name ?? client.name}</h1>
      <p>Find decisions, blockers, and current work without scrolling through full AI reports.</p></div></header>
    {relatedFolders.length > 1 && <details className="clean-panel compact-intel-folders"><summary>{relatedFolders.length} ClickUp folders consolidated into this client</summary><p>{relatedFolders.map(folder => folder.name).join(' · ')}</p></details>}
    <div className="detail-stat-strip">
      <div><strong>{tasks.length}</strong><span>Imported tasks</span></div>
      <div><strong>{analyzedCount}</strong><span>AI analyzed</span></div>
      <div><strong>{needsAmi.length}</strong><span>Need Ami · filtered</span></div>
      <div><strong>{waiting.length}</strong><span>Waiting · filtered</span></div>
    </div>
    <form className="filter-bar clean-filters" method="GET">
      <label className="search-label">Find a task<input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Search tasks, people, or summaries…" /></label>
      <label>Team member<select name="assignee" defaultValue={filters.assignee ?? ''}><option value="">Everyone</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>ClickUp status<select name="status" defaultValue={filters.status ?? ''}><option value="">Any status</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>Activity<select name="age" defaultValue={filters.age ?? ''}><option value="">Any time</option><option value="recent">Recently active</option><option value="30">Stale active</option></select></label>
      <button type="submit">Show results</button><a href={`/clients/${slug}`}>Clear filters</a>
    </form>
    <p className="filter-results">{filtered.length} of {tasks.length} imported tasks match. {analyzedCount} of {tasks.length} have AI assessments; the action counts do not cover unanalyzed tasks.</p>
    <div className="detail-sections compact-intel-sections">
      <CompactTaskSection title="Needs Ami" eyebrow="FIRST PRIORITY" tasks={needsAmi} sectionId="needs-ami" {...sectionProps} />
      <CompactTaskSection title="Waiting on someone" eyebrow="DEPENDENCIES" tasks={waiting} sectionId="waiting" {...sectionProps} />
      <CompactTaskSection title="Recently active" eyebrow="IN PROGRESS" tasks={recentlyActive} sectionId="active" {...sectionProps} />
      <CompactTaskSection title="Stale active" tasks={stale} sectionId="stale" collapsed {...sectionProps} />
      <CompactTaskSection title="Not started" tasks={notStarted} sectionId="not-started" collapsed {...sectionProps} />
      <CompactTaskSection title="Other analyzed tasks" tasks={other} sectionId="other" collapsed {...sectionProps} />
      <CompactTaskSection title="Completed" tasks={completed} sectionId="completed" collapsed {...sectionProps} />
      <CompactTaskSection title="Awaiting AI analysis" tasks={unanalyzed} sectionId="unanalyzed" collapsed {...sectionProps} />
    </div>
  </main>;
}
