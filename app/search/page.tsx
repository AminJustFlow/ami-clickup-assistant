import { changedSinceAnalysis, isClosedClickUpStatus } from '@/lib/attention/triage';
import { TaskDetailsButton } from '../components/task-details';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';
import { compareRecentFirst } from '@/lib/tasks/recency';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 120);
  const hasQuery = query.length > 0;
  const [clients, employees, tasks] = hasQuery ? await Promise.all([
    prisma.client.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' }, take: 20 }),
    prisma.employee.findMany({ where: { name: { contains: query, mode: 'insensitive' } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 }),
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
      select: {
        id: true, name: true, clickupStatus: true, clickupUpdatedAt: true, clickupUrl: true,
        client: { select: { name: true, slug: true } },
        intelligence: { select: { needsAmi: true, agentState: true, analyzedAt: true, freshnessStatus: true, amiAction: true, currentSummary: true, lastMeaningfulChangeAt: true, verificationStatus: true } },
        comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1, select: { occurredAt: true } },
        assignees: { select: { employee: { select: { name: true } } } }
      },
      orderBy: { clickupUpdatedAt: 'desc' },
      take: 60
    })
  ]) : [[], [], []];
  tasks.sort(compareRecentFirst);

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
      {tasks.length > 0 && <section className="clean-panel"><div className="panel-heading"><h2>Tasks</h2><span className="panel-count">{tasks.length}</span></div><div className="clean-task-list">{tasks.map(task => {
        const intel = task.intelligence;
        const historical = !!intel && (!intel.analyzedAt || changedSinceAnalysis(task, intel.analyzedAt) ||
          intel.freshnessStatus === 'STALE' || intel.freshnessStatus === 'UNCERTAIN' ||
          (isClosedClickUpStatus(task.clickupStatus) && intel.agentState !== 'COMPLETED'));
        const label = !intel ? 'Unanalyzed' : historical ? 'Prior assessment' : intel.needsAmi
          ? (intel.verificationStatus === 'VERIFIED' ? 'Needs Ami' : 'Possible Ami action ? verify')
          : intel.agentState.replaceAll('_', ' ').toLowerCase();
        return <article className="clean-task" key={task.id}>
        <div className="task-topline"><span>{task.client.name}</span><span className="status-pill">ClickUp: {task.clickupStatus ?? 'Unknown'} ? {label}</span></div>
        {!historical && intel?.needsAmi && intel.amiAction && <div className="task-decision"><strong>{intel.verificationStatus === 'VERIFIED' ? 'Next action for Ami' : 'Unverified AI suggestion'}</strong><p>{intel.amiAction}</p></div>}
        <h3>{task.name}</h3>
        {intel?.currentSummary && <p>{historical && <strong>Last assessment {intel.analyzedAt?.toISOString().slice(0, 10)} ? Current situation unconfirmed. </strong>}{intel.currentSummary}</p>}
        <div className="task-footer"><span>{task.assignees.map(a=>a.employee.name).join(', ') || 'Unassigned'}</span><span className="task-card-actions"><TaskDetailsButton taskId={task.id} /><a href={`/clients/${task.client.slug}?q=${encodeURIComponent(task.name)}`}>View in client ↗</a>{task.clickupUrl && <> · <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open ClickUp ↗</a></>}</span></div>
      </article>})}</div></section>}
    </div>}
  </main>;
}
