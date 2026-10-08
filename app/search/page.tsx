import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 120);
  const hasQuery = query.length > 0;
  const [clients, employees, tasks] = hasQuery ? await Promise.all([
    prisma.client.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, orderBy: { name: 'asc' }, take: 20 }),
    prisma.employee.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, orderBy: { name: 'asc' }, take: 20 }),
    prisma.task.findMany({
      where: {
        deleted: false,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { client: { name: { contains: query, mode: 'insensitive' } } },
          { assignees: { some: { employee: { name: { contains: query, mode: 'insensitive' } } } } },
          { intelligence: { is: { OR: [
            { currentSummary: { contains: query, mode: 'insensitive' } },
            { amiAction: { contains: query, mode: 'insensitive' } },
            { waitingOnName: { contains: query, mode: 'insensitive' } }
          ] } } }
        ]
      },
      include: { client: true, intelligence: true, assignees: { include: { employee: true } } },
      orderBy: { clickupUpdatedAt: 'desc' },
      take: 60
    })
  ]) : [[], [], []];

  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="overview" />
    <header className="detail-hero search-hero">
      <p className="eyebrow">FIND ANYTHING</p>
      <h1>Search Just Flow</h1>
      <p>Find tasks, clients, and team members in one place.</p>
    </header>
    <form className="global-search-form" action="/search" method="GET" role="search">
      <label htmlFor="global-search-q">What are you looking for?</label>
      <div className="global-search-input-row">
        <input id="global-search-q" name="q" type="search" autoFocus defaultValue={query} placeholder="Try a client, task, teammate, or topic…" maxLength={120} />
        <button type="submit">Search</button>
      </div>
    </form>
    {!hasQuery ? <div className="friendly-empty search-empty"><strong>Search across your workspace</strong><p>Try “Magical Tour”, “Monica”, or “website”.</p></div> :
    <div className="search-results" aria-live="polite">
      <p className="filter-results">Results for <strong>{query}</strong> · {clients.length} clients · {employees.length} team members · {tasks.length} tasks{tasks.length === 60 ? ' (showing first 60)' : ''}</p>
      {clients.length === 0 && employees.length === 0 && tasks.length === 0 && <div className="friendly-empty"><strong>No matches found</strong><p>Try a shorter name or a different keyword.</p></div>}
      {clients.length > 0 && <section className="clean-panel"><div className="panel-heading"><h2>Clients</h2><span className="panel-count">{clients.length}</span></div><div className="entity-list">{clients.map(client => <a className="entity-row" href={`/clients/${client.slug}`} key={client.id}><span className="entity-avatar">{client.name.slice(0,1).toUpperCase()}</span><span className="entity-copy"><strong>{client.name}</strong><small>Open client overview</small></span><span className="entity-arrow">›</span></a>)}</div></section>}
      {employees.length > 0 && <section className="clean-panel"><div className="panel-heading"><h2>Team</h2><span className="panel-count">{employees.length}</span></div><div className="entity-list">{employees.map(employee => <a className="entity-row" href={`/employees/${employee.id}`} key={employee.id}><span className="entity-avatar team-avatar">{employee.name.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase()}</span><span className="entity-copy"><strong>{employee.name}</strong><small>Open team member overview</small></span><span className="entity-arrow">›</span></a>)}</div></section>}
      {tasks.length > 0 && <section className="clean-panel"><div className="panel-heading"><h2>Tasks</h2><span className="panel-count">{tasks.length}</span></div><div className="clean-task-list">{tasks.map(task => <article className="clean-task" key={task.id}>
        <div className="task-topline"><span>{task.client.name}</span><span className="status-pill">{task.intelligence?.needsAmi ? 'Needs Ami' : task.intelligence?.agentState?.replaceAll('_',' ').toLowerCase() || task.clickupStatus || 'Task'}</span></div>
        {task.intelligence?.needsAmi && task.intelligence.amiAction && <div className="task-decision"><strong>Next action for Ami</strong><p>{task.intelligence.amiAction}</p></div>}
        <h3>{task.name}</h3>
        {task.intelligence?.currentSummary && <p>{task.intelligence.currentSummary}</p>}
        <div className="task-footer"><span>{task.assignees.map(a=>a.employee.name).join(', ') || 'Unassigned'}</span><span><a href={`/clients/${task.client.slug}?q=${encodeURIComponent(task.name)}`}>View in client ↗</a>{task.clickupUrl && <> · <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open ClickUp ↗</a></>}</span></div>
      </article>)}</div></section>}
    </div>}
  </main>;
}
