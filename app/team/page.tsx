import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function TeamDirectory({ searchParams }: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const { q = '', sort = 'name' } = await searchParams;
  const people = await prisma.employee.findMany({
    where: { assignments: { some: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } } } },
    select: {
      id: true, name: true,
      assignments: {
        where: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } },
        select: { taskId: true }
      }
    },
    orderBy: { name: 'asc' }
  });
  const search = q.trim().toLowerCase();
  const filtered = people.filter(person => person.name.toLowerCase().includes(search)).sort((a, b) =>
    sort === 'tasks' ? b.assignments.length - a.assignments.length || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)
  );
  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="team" />
    <header className="detail-hero"><p className="eyebrow">TEAM DIRECTORY</p><h1>Team workload</h1>
      <p>Find employees and explore their assignments, blockers, and progress.</p></header>
    <section className="clean-panel directory-panel">
      <div className="panel-heading"><div><h2>People</h2><p>Employees with imported ClickUp assignments.</p></div>
        <span className="panel-count">{people.length}</span></div>
      <form className="filter-bar clean-filters directory-filters" method="GET">
        <label className="search-label">Search team<input type="search" name="q" defaultValue={q} placeholder="Employee name…" /></label>
        <label>Sort by<select name="sort" defaultValue={sort}><option value="name">Employee name</option><option value="tasks">Most imported assignments</option></select></label>
        <button type="submit">Apply</button><a href="/team">Clear</a>
      </form>
      <p className="directory-result-count">{filtered.length} of {people.length} employees · Historical assignments are not a measure of current workload.</p>
      <div className="directory-grid">{filtered.map(person => <a className="directory-entry" key={person.id} href={`/employees/${person.id}`}>
        <span className="entity-avatar team-avatar">{person.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}</span>
        <span><strong>{person.name}</strong><small>{person.assignments.length.toLocaleString()} imported assignments</small></span>
        <span aria-hidden="true">↗</span></a>)}</div>
      {filtered.length === 0 && <p className="simple-empty directory-empty">No employees match your search.</p>}
    </section>
  </main>;
}
