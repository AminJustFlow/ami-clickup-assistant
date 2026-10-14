import { isClosedClickUpStatus, isOpenAttentionTask } from '@/lib/attention/triage';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

type Sort = 'name' | 'open' | 'overdue' | 'attention' | 'tasks';
type Show = 'all' | 'open' | 'overdue' | 'attention';

export default async function TeamDirectory({ searchParams }: {
  searchParams: Promise<{ q?: string; sort?: string; show?: string }>;
}) {
  const { q = '', sort: requestedSort = 'open', show: requestedShow = 'all' } = await searchParams;
  const sort: Sort = (['name', 'open', 'overdue', 'attention', 'tasks'] as const).includes(requestedSort as Sort) ? requestedSort as Sort : 'open';
  const show: Show = (['all', 'open', 'overdue', 'attention'] as const).includes(requestedShow as Show) ? requestedShow as Show : 'all';
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const people = await prisma.employee.findMany({
    where: { assignments: { some: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } } } },
    select: {
      id: true, name: true,
      assignments: {
        where: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } },
        select: { task: { select: {
          clickupStatus: true, dueDate: true,
          intelligence: { select: { agentState: true, needsAmi: true, sourceFingerprint: true, analyzedAt: true } },
          attentionDisposition: { select: { sourceFingerprint: true, decision: true } }
        } } }
      }
    },
    orderBy: { name: 'asc' }
  });

  const summaries = people.map(person => {
    let open = 0, overdue = 0, dueSoon = 0, needsAmi = 0;
    for (const { task } of person.assignments) {
      if (isClosedClickUpStatus(task.clickupStatus)) continue;
      open++;
      if (task.dueDate && task.dueDate < now) overdue++;
      else if (task.dueDate && task.dueDate <= nextWeek) dueSoon++;
      if (isOpenAttentionTask(task)) needsAmi++;
    }
    return { id: person.id, name: person.name, imported: person.assignments.length, open, overdue, dueSoon, needsAmi };
  });
  const search = q.trim().toLowerCase();
  const filtered = summaries.filter(person =>
    person.name.toLowerCase().includes(search) &&
    (show === 'all' || (show === 'open' && person.open > 0) ||
      (show === 'overdue' && person.overdue > 0) || (show === 'attention' && person.needsAmi > 0))
  ).sort((a, b) => {
    const key = sort === 'tasks' ? 'imported' : sort === 'attention' ? 'needsAmi' : sort;
    if (key === 'name') return a.name.localeCompare(b.name);
    return b[key] - a[key] || a.name.localeCompare(b.name);
  });
  const totals = summaries.reduce((sum, person) => ({
    open: sum.open + person.open, overdue: sum.overdue + person.overdue,
    dueSoon: sum.dueSoon + person.dueSoon, needsAmi: sum.needsAmi + person.needsAmi
  }), { open: 0, overdue: 0, dueSoon: 0, needsAmi: 0 });

  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="team" />
    <header className="detail-hero"><p className="eyebrow">TEAM DIRECTORY</p><h1>Team workload</h1>
      <p>See current open assignments, deadlines, and decisions by team member.</p></header>
    <section className="team-workload-metrics" aria-label="Team assignment overview">
      <div className="team-workload-metric"><strong>{people.length.toLocaleString()}</strong><span>Team members</span></div>
      <div className="team-workload-metric"><strong>{totals.open.toLocaleString()}</strong><span>Open assignments</span></div>
      <div className="team-workload-metric"><strong>{totals.overdue.toLocaleString()}</strong><span>Past-due assignments</span></div>
      <div className="team-workload-metric"><strong>{totals.needsAmi.toLocaleString()}</strong><span>Needs Ami decisions</span></div>
    </section>
    <p className="team-workload-note">Counts are based on imported ClickUp assignments in active JF Corporate clients. Shared tasks count once for each assignee. Past due means an open task with a due date before the current time; these are not verified workload or capacity estimates. AI decisions are unverified.</p>
    <section className="clean-panel directory-panel">
      <div className="panel-heading"><div><h2>People</h2><p>Prioritize who needs follow-up, then open their individual task view.</p></div>
        <span className="panel-count">{people.length}</span></div>
      <form className="filter-bar clean-filters directory-filters" method="GET">
        <label className="search-label">Search team<input type="search" name="q" defaultValue={q} placeholder="Employee name…" /></label>
        <label>Show<select name="show" defaultValue={show}>
          <option value="all">Everyone</option><option value="open">With open tasks</option>
          <option value="overdue">With past-due tasks</option><option value="attention">With Needs Ami</option>
        </select></label>
        <label>Sort by<select name="sort" defaultValue={sort}>
          <option value="open">Most open assignments</option><option value="overdue">Most past due</option>
          <option value="attention">Most Needs Ami</option><option value="name">Employee name</option>
          <option value="tasks">Most imported assignments</option>
        </select></label>
        <button type="submit">Apply</button><a href="/team">Clear</a>
      </form>
      <p className="directory-result-count">{filtered.length} of {people.length} team members · Showing imported task assignments, not hours or capacity.</p>
      <div className="directory-grid">{filtered.map(person => <a className="directory-entry team-workload-entry" key={person.id} href={`/employees/${person.id}`}>
        <span className="entity-avatar team-avatar">{person.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span className="team-workload-person"><strong>{person.name}</strong>
          <small>{person.imported.toLocaleString()} imported assignments</small>
          <span className="team-workload-tags">
            <span>{person.open.toLocaleString()} open</span>
            <span className={person.overdue > 0 ? 'team-workload-overdue' : ''}>{person.overdue.toLocaleString()} past due</span>
            <span>{person.dueSoon.toLocaleString()} due in 7 days</span>
            {person.needsAmi > 0 && <span className="team-workload-attention">{person.needsAmi.toLocaleString()} Needs Ami</span>}
          </span>
        </span>
        <span aria-hidden="true">↗</span></a>)}</div>
      {filtered.length === 0 && <p className="simple-empty directory-empty">No team members match these filters.</p>}
    </section>
  </main>;
}
