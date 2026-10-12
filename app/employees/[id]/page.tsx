import { isStaleActive } from '@/lib/intelligence/staleness';
import { isOpenAttentionTask, isClosedClickUpStatus } from '@/lib/attention/triage';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';
import { CompactTaskSection } from '../../components/compact-task-list';

export const dynamic = 'force-dynamic';

type Filters = { q?: string; client?: string; status?: string; section?: string; page?: string };

export default async function EmployeePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Filters>;
}) {
  const { id } = await params;
  const filters = await searchParams;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) notFound();
  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null }, assignees: { some: { employeeId } } },
    include: {
      client: true, intelligence: true, attentionDisposition: true, list: true,
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
      assignees: { include: { employee: true } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const clientOptions = [...new Map(tasks.map(t => [t.client.id, { id: t.client.id, name: t.client.name }] as const)).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const statusOptions = [...new Set(tasks.map(t => t.intelligence?.agentState).filter((s): s is NonNullable<typeof s> => Boolean(s)))].sort();
  const search = (filters.q ?? '').trim().toLowerCase();
  const matches = (t: typeof tasks[number]) =>
    (!search || [t.name, t.client.name, t.list.name, t.intelligence?.currentSummary ?? '',
      t.intelligence?.amiAction ?? ''].some(value => value.toLowerCase().includes(search))) &&
    (!filters.client || String(t.clientId) === filters.client) &&
    (!filters.status || t.intelligence?.agentState === filters.status);
  const filtered = tasks.filter(matches);
  const needsAmi = filtered.filter(isOpenAttentionTask);
  const isClosed = (t: (typeof tasks)[number]) => t.intelligence?.agentState === 'COMPLETED' || isClosedClickUpStatus(t.clickupStatus);
  const waiting = filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) &&
    t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI');
  const active = filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) && !waiting.includes(t) && t.intelligence?.agentState === 'ACTIVE');
  const stale = active.filter(t => isStaleActive({
    state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt,
    commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt])
  }));
  const recent = active.filter(t => !stale.includes(t));
  const notStarted = filtered.filter(t => t.intelligence?.agentState === 'NOT_STARTED' && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const completed = filtered.filter(t => isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const other = filtered.filter(t => t.intelligence && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t) && !active.includes(t) && !notStarted.includes(t));
  const query = new URLSearchParams();
  for (const key of ['q', 'client', 'status'] as const) if (filters[key]) query.set(key, filters[key]);
  const sectionProps = { section: filters.section, page: filters.page, query: query.toString() };

  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="team" />
    <header className="detail-hero"><div><a className="back-link" href="/#team">← All team members</a>
      <p className="eyebrow">TEAM MEMBER</p><h1>{employee.name}</h1>
      <p>Find assignments, dependencies, and recent work by client.</p></div></header>
    <div className="detail-stat-strip">
      <div><strong>{tasks.length}</strong><span>Analyzed assignments</span></div>
      <div><strong>{needsAmi.length}</strong><span>Need Ami · filtered</span></div>
      <div><strong>{waiting.length}</strong><span>Waiting · filtered</span></div>
      <div><strong>{active.length}</strong><span>In progress · filtered</span></div>
    </div>
    <form className="filter-bar clean-filters" method="GET">
      <label className="search-label">Find a task<input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Search tasks, clients, or summaries…" /></label>
      <label>Client<select name="client" defaultValue={filters.client ?? ''}><option value="">All clients</option>{clientOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>AI status<select name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{statusOptions.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select></label>
      <button type="submit">Show results</button><a href={`/employees/${employeeId}`}>Clear</a>
    </form>
    <p className="filter-results">{filtered.length} of {tasks.length} analyzed assignments match. Tasks without AI assessments are not included in this view.</p>
    <div className="detail-sections compact-intel-sections">
      <CompactTaskSection title="Needs Ami" eyebrow="FIRST PRIORITY" tasks={needsAmi} sectionId="needs-ami" {...sectionProps} />
      <CompactTaskSection title="Waiting on someone" eyebrow="DEPENDENCIES" tasks={waiting} sectionId="waiting" {...sectionProps} />
      <CompactTaskSection title="Recently active" eyebrow="IN PROGRESS" tasks={recent} sectionId="active" {...sectionProps} />
      <CompactTaskSection title="Stale active" tasks={stale} sectionId="stale" collapsed {...sectionProps} />
      <CompactTaskSection title="Not started" tasks={notStarted} sectionId="not-started" collapsed {...sectionProps} />
      <CompactTaskSection title="Other analyzed tasks" tasks={other} sectionId="other" collapsed {...sectionProps} />
      <CompactTaskSection title="Completed" tasks={completed} sectionId="completed" collapsed {...sectionProps} />
    </div>
  </main>;
}
