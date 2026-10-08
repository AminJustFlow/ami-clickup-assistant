import { isStaleActive } from '@/lib/intelligence/staleness';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const waitingStates = ['WAITING_ON_AMI', 'WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'BLOCKED', 'ISSUE'];

const stateLabel: Record<string, string> = {
  WAITING_ON_AMI: 'Waiting on Ami',
  WAITING_ON_TEAM: 'Waiting on team',
  WAITING_ON_CLIENT: 'Waiting on client',
  WAITING_ON_VENDOR: 'Waiting on vendor',
  BLOCKED: 'Blocked',
  ISSUE: 'Issue',
  ACTIVE: 'Active',
  COMPLETED: 'Completed'
};

export default async function Home() {
  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null } },
    include: {
      client: true,
      intelligence: true,
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
      assignees: { include: { employee: true } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });

  const needsAmi = tasks.filter((task) => task.intelligence?.needsAmi);
  const waiting = tasks.filter((task) => task.intelligence && waitingStates.includes(task.intelligence.agentState));
  const active = tasks.filter((task) => task.intelligence?.agentState === 'ACTIVE');
  const stale = active.filter(t => isStaleActive({ state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }));
  const staleIds = new Set(stale.map(t => t.id));
  const completed = tasks.filter((task) => task.intelligence?.agentState === 'COMPLETED');

  const clientRows = new Map<string, { name: string; total: number; needsAmi: number; waiting: number; active: number; stale: number }>();
  for (const task of tasks) {
    const row = clientRows.get(task.client.slug) ?? { name: task.client.name, total: 0, needsAmi: 0, waiting: 0, active: 0, stale: 0 };
    row.total += 1;
    if (task.intelligence?.needsAmi) row.needsAmi += 1;
    if (task.intelligence && waitingStates.includes(task.intelligence.agentState)) row.waiting += 1;
    if (task.intelligence?.agentState === 'ACTIVE' && !staleIds.has(task.id)) row.active += 1;
    if (staleIds.has(task.id)) row.stale += 1;
    clientRows.set(task.client.slug, row);
  }

  const employeeRows = new Map<string, { id: number; total: number; waiting: number; needsAmi: number; stale: number }>();
  for (const task of tasks) {
    for (const { employee } of task.assignees) {
      const row = employeeRows.get(employee.name) ?? { id: employee.id, total: 0, waiting: 0, needsAmi: 0, stale: 0 };
      row.total += 1;
      if (task.intelligence && waitingStates.includes(task.intelligence.agentState)) row.waiting += 1;
      if (task.intelligence?.needsAmi) row.needsAmi += 1;
      if (staleIds.has(task.id)) row.stale += 1;
      employeeRows.set(employee.name, row);
    }
  }


  const externalWaiting = waiting.filter(t => !t.intelligence?.needsAmi);
  const orderedClients = [...clientRows.entries()].sort((a,b) => b[1].needsAmi-a[1].needsAmi || b[1].waiting-a[1].waiting || a[1].name.localeCompare(b[1].name));
  const orderedEmployees = [...employeeRows.entries()].sort((a,b) => b[1].needsAmi-a[1].needsAmi || b[1].waiting-a[1].waiting || a[0].localeCompare(b[0]));

  return <main className="ops-shell dashboard-shell">
    <nav className="app-nav" aria-label="Main navigation">
      <a className="app-brand" href="/"><span className="brand-mark">JF</span><span>Just Flow <small>Intelligence</small></span></a>
      <div className="app-nav-links"><a href="/" aria-current="page">Overview</a><a href="/changes">Activity</a><a href="#clients">Clients</a><a href="#team">Team</a></div>
      <details className="tools-menu"><summary>Tools</summary><div><a href="/review">AI quality review</a><a href="/debug/voth/intelligence">Evidence explorer</a></div></details>
    </nav>

    <header className="dashboard-hero">
      <div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>Good overview, fewer surprises.</h1><p>See what needs a decision, what is moving, and what is waiting.</p></div>
      <a className="quiet-action" href="/changes">See recent activity <span aria-hidden="true">↗</span></a>
    </header>

    <section className="dashboard-metrics" aria-label="Work summary">
      <div className="overview-stat primary-stat"><span>Needs your attention</span><strong>{needsAmi.length}</strong><small>Decisions or actions for Ami</small></div>
      <div className="overview-stat"><span>Waiting on others</span><strong>{externalWaiting.length}</strong><small>Team, clients and vendors</small></div>
      <div className="overview-stat"><span>In progress</span><strong>{active.length}</strong><small>{stale.length} may need a follow-up</small></div>
      <div className="overview-stat"><span>Completed</span><strong>{completed.length}</strong><small>Of {tasks.length} analyzed tasks</small></div>
    </section>

    <div className="dashboard-main">
      <div className="dashboard-primary">
        <section className="clean-panel" aria-labelledby="attention-title">
          <div className="panel-heading"><div><p className="eyebrow">FIRST PRIORITY</p><h2 id="attention-title">Your attention</h2><p>Only items with a specific action for Ami.</p></div><span className="panel-count">{needsAmi.length}</span></div>
          {needsAmi.length === 0 ? <div className="friendly-empty"><span aria-hidden="true">✓</span><strong>You're all caught up</strong><p>No tasks currently require your action.</p></div> :
            <div className="clean-task-list">{needsAmi.map(task => <article className="clean-task" key={task.id}>
              <div className="task-topline"><span>{task.client.name}</span><span className="status-pill attention-pill">Action needed</span></div>
              <h3>{task.name}</h3><p>{task.intelligence?.amiAction || task.intelligence?.currentSummary || 'Review this task.'}</p>
              {task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noreferrer">View in ClickUp <span aria-hidden="true">↗</span></a>}
            </article>)}</div>}
        </section>

        <section className="clean-panel" aria-labelledby="waiting-title">
          <div className="panel-heading"><div><p className="eyebrow">DEPENDENCIES</p><h2 id="waiting-title">Waiting on others</h2><p>Who needs to move next, and why.</p></div><span className="panel-count">{externalWaiting.length}</span></div>
          {externalWaiting.length === 0 ? <div className="friendly-empty"><strong>No outstanding dependencies</strong><p>Nothing is currently marked as waiting.</p></div> :
            <div className="clean-task-list">{externalWaiting.slice(0,8).map(task => <article className="clean-task" key={task.id}>
              <div className="task-topline"><span>{task.client.name}</span><span className="status-pill">{stateLabel[task.intelligence!.agentState] ?? 'Waiting'}</span></div>
              <h3>{task.name}</h3><p>{task.intelligence?.currentSummary || 'Awaiting an update.'}</p>
              <div className="task-footer"><span>{task.intelligence?.waitingOnName ? 'With ' + task.intelligence.waitingOnName : 'Awaiting next step'}</span>{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open task ↗</a>}</div>
            </article>)}
            {externalWaiting.length > 8 && <p className="list-footnote">Showing 8 of {externalWaiting.length} waiting tasks. Open a client below to see more.</p>}</div>}
        </section>
      </div>

      <aside className="dashboard-sidebar">
        <section className="clean-panel" id="clients" aria-labelledby="clients-title">
          <div className="panel-heading"><div><p className="eyebrow">AT A GLANCE</p><h2 id="clients-title">Clients</h2></div><span className="panel-count">{orderedClients.length}</span></div>
          <div className="entity-list">{orderedClients.map(([slug,client]) => <a className="entity-row" key={slug} href={`/clients/${slug}`}><span className="entity-avatar">{client.name.slice(0,1).toUpperCase()}</span><span className="entity-copy"><strong>{client.name}</strong><small>{client.total} tasks · {client.waiting} waiting</small></span>{client.needsAmi > 0 && <span className="entity-alert">{client.needsAmi} for Ami</span>}<span className="entity-arrow">›</span></a>)}</div>
        </section>
        <section className="clean-panel" id="team" aria-labelledby="team-title">
          <div className="panel-heading"><div><p className="eyebrow">WORKLOAD</p><h2 id="team-title">Team</h2></div><span className="panel-count">{orderedEmployees.length}</span></div>
          <div className="entity-list">{orderedEmployees.map(([name,employee]) => <a className="entity-row" key={employee.id} href={`/employees/${employee.id}`}><span className="entity-avatar team-avatar">{name.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase()}</span><span className="entity-copy"><strong>{name}</strong><small>{employee.total} assigned · {employee.waiting} waiting</small></span><span className="entity-arrow">›</span></a>)}</div>
        </section>
        <div className="dashboard-note">Intelligence is inferred from ClickUp tasks and comments. Open a task to verify its latest details.</div>
      </aside>
    </div>
  </main>;
}
