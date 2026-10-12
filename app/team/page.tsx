import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function TeamDirectory() {
  const people = await prisma.employee.findMany({
    where: { assignments: { some: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } } } },
    select: { id: true, name: true, assignments: { where: { task: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } }, select: { taskId: true } } },
    orderBy: { name: 'asc' }
  });
  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="team" />
    <header className="detail-hero"><p className="eyebrow">TEAM DIRECTORY</p><h1>Team workload</h1><p>Find people and explore their ClickUp task assignments.</p></header>
    <section className="clean-panel directory-panel"><div className="panel-heading"><div><h2>People</h2><p>Employees with imported assignments.</p></div><span className="panel-count">{people.length}</span></div>
      <div className="directory-grid">{people.map(person => <a className="directory-entry" key={person.id} href={`/employees/${person.id}`}><span className="entity-avatar team-avatar">{person.name.split(' ').map(p => p[0]).slice(0,2).join('').toUpperCase()}</span><span><strong>{person.name}</strong><small>{person.assignments.length} assigned tasks</small></span><span aria-hidden="true">↗</span></a>)}</div>
    </section>
  </main>;
}
