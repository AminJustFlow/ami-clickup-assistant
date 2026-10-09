import { TaskDetailsButton } from './components/task-details';
import { isStaleActive } from '@/lib/intelligence/staleness';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from './components/app-nav';
import { groupClientFolders, needsClientAttribution } from '@/lib/clients/grouping';

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
  const vothSync = await prisma.client.findUnique({ where: { slug: 'voth' }, select: { lastSyncedAt: true } });
  const lastSync = vothSync?.lastSyncedAt ?? null;
  const staleSync = !lastSync || Date.now() - lastSync.getTime() > 15 * 60 * 1000;
  const syncLabel = lastSync ? lastSync.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Not yet synced';
  const tasks = await prisma.task.findMany({
    where: { deleted: false, client: { space: { name: 'JF Corporate' } }, intelligence: { isNot: null } },
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

  const clientRows = new Map<string, { name: string; total: number; analyzed: number; needsAmi: number; waiting: number; active: number; stale: number }>();
  const allClients = await prisma.client.findMany({ where: { active: true, space: { name: 'JF Corporate' } }, select: { id: true, slug: true, name: true } });
  const groups = groupClientFolders(allClients);
  const canonicalById = new Map(groups.flatMap(group => group.folders.map(folder => [folder.id, group.canonical.slug] as const)));
  const importedCounts = await prisma.task.groupBy({ by: ['clientId'], where: { deleted: false, client: { space: { name: 'JF Corporate' } } }, _count: { _all: true } });
  const totalsByClient = new Map(importedCounts.map(row => [row.clientId, row._count._all]));
  for (const group of groups) {
    clientRows.set(group.canonical.slug, {
      name: group.canonical.name,
      total: group.folders.reduce((sum, folder) => sum + (totalsByClient.get(folder.id) ?? 0), 0),
      analyzed: 0, needsAmi: 0, waiting: 0, active: 0, stale: 0
    });
  }
  for (const task of tasks) {
    const slug = canonicalById.get(task.clientId) ?? task.client.slug;
    const row = clientRows.get(slug);
    if (!row) continue;
    row.analyzed += 1;
    if (task.intelligence?.needsAmi) row.needsAmi += 1;
    if (task.intelligence && waitingStates.includes(task.intelligence.agentState) && task.intelligence.agentState !== 'WAITING_ON_AMI') row.waiting += 1;
    if (task.intelligence?.agentState === 'ACTIVE' && !staleIds.has(task.id)) row.active += 1;
    if (staleIds.has(task.id)) row.stale += 1;
  }

  const employeeRows = new Map<string, { id: number; total: number; waiting: number; needsAmi: number; stale: number }>();
  for (const task of tasks) {
    for (const { employee } of task.assignees) {
      const row = employeeRows.get(employee.name) ?? { id: employee.id, total: 0, waiting: 0, needsAmi: 0, stale: 0 };
      row.total += 1;
      if (task.intelligence && waitingStates.includes(task.intelligence.agentState) && task.intelligence.agentState !== 'WAITING_ON_AMI') row.waiting += 1;
      if (task.intelligence?.needsAmi) row.needsAmi += 1;
      if (staleIds.has(task.id)) row.stale += 1;
      employeeRows.set(employee.name, row);
    }
  }


  const externalWaiting = waiting.filter(t => t.intelligence?.agentState !== 'WAITING_ON_AMI');
  const waitingGroups = new Map<string, typeof externalWaiting>();
  for (const task of externalWaiting) {
    const kind = task.intelligence?.waitingOnType ?? 'OTHER';
    const name = task.intelligence?.waitingOnName?.trim() || (kind === 'TEAM' ? 'Unspecified team member' : kind === 'CLIENT' ? 'Unspecified client contact' : kind === 'VENDOR' ? 'Unspecified vendor' : 'Unspecified owner');
    const key = kind + ':' + name.toLowerCase();
    const group = waitingGroups.get(key) ?? [];
    group.push(task);
    waitingGroups.set(key, group);
  }
  const groupedWaiting = [...waitingGroups.entries()].sort((a,b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const unattributedFolders = [...clientRows.entries()].filter(([, client]) => needsClientAttribution(client.name)).sort((a,b) => b[1].total - a[1].total);
  const orderedClients = [...clientRows.entries()].filter(([, client]) => !needsClientAttribution(client.name)).sort((a,b) => b[1].needsAmi-a[1].needsAmi || b[1].waiting-a[1].waiting || a[1].name.localeCompare(b[1].name));
  const orderedEmployees = [...employeeRows.entries()].sort((a,b) => b[1].needsAmi-a[1].needsAmi || b[1].waiting-a[1].waiting || a[0].localeCompare(b[0]));

  return <main className="ops-shell dashboard-shell">
    <AppNav current="overview" />

    <header className="dashboard-hero">
      <div><p className="eyebrow">OPERATIONS OVERVIEW</p><h1>What needs attention today?</h1><p>Decisions to make, people to follow up with, and client progress — all in one place.</p></div>
      <a className="quiet-action" href="/changes">See recent activity <span aria-hidden="true">↗</span></a>
    </header>

    <div className={"sync-status " + (staleSync ? "sync-status-warning" : "sync-status-current")} role="status"><span aria-hidden="true">{staleSync ? "◷" : "✓"}</span><span>{staleSync ? "VOTH sync may be out of date" : "VOTH ClickUp data synced"} · Last successful sync: {syncLabel}</span></div>

    <section className="dashboard-metrics" aria-label="Work summary">
      <a href="#attention-title" className="overview-stat primary-stat metric-link"><span>Needs your attention</span><strong>{needsAmi.length}</strong><small>Decisions or actions for Ami ↓</small></a>
      <a href="#waiting-title" className="overview-stat metric-link"><span>Waiting on others</span><strong>{externalWaiting.length}</strong><small>Team, clients and vendors ↓</small></a>
      <div className="overview-stat"><span>In progress</span><strong>{active.length}</strong><small>{stale.length} may need a follow-up</small></div>
      <div className="overview-stat"><span>Completed</span><strong>{completed.length}</strong><small>Of {tasks.length} analyzed tasks</small></div>
    </section>

    <div className="dashboard-main" id="main-content">
      <div className="dashboard-primary">
        <section className="clean-panel" aria-labelledby="attention-title">
          <div className="panel-heading"><div><p className="eyebrow">FIRST PRIORITY</p><h2 id="attention-title">Decisions for Ami</h2><p>Questions, approvals, and next steps that need your response.</p></div><span className="panel-count">{needsAmi.length}</span></div>
          {needsAmi.length === 0 ? <div className="friendly-empty"><span aria-hidden="true">✓</span><strong>You're all caught up</strong><p>No tasks currently require your action.</p></div> :
            <div className="clean-task-list">{needsAmi.map(task => <article className="clean-task" key={task.id}>
              <div className="task-topline"><span>{task.client.name}</span><span className="status-pill attention-pill">Action needed</span></div>
              <p className="next-step-label">Your next action</p><p className="ami-next-action">{task.intelligence?.amiAction || task.intelligence?.currentSummary || 'Review this task.'}</p><h3 className="task-context-title">{task.name}</h3>{task.intelligence?.agentState !== 'WAITING_ON_AMI' && <span className="secondary-dependency">Also {stateLabel[task.intelligence?.agentState ?? '']?.toLowerCase() ?? 'in progress'}</span>}
              <TaskDetailsButton taskId={task.id} />{task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noreferrer">View in ClickUp <span aria-hidden="true">↗</span></a>}
            </article>)}</div>}
        </section>

        <section className="clean-panel" aria-labelledby="waiting-title">
          <div className="panel-heading"><div><p className="eyebrow">DEPENDENCIES</p><h2 id="waiting-title">Who are we waiting on?</h2><p>Tasks waiting on teammates, clients, or vendors.</p></div><span className="panel-count">{externalWaiting.length}</span></div>
          {externalWaiting.length === 0 ? <div className="friendly-empty"><strong>No outstanding dependencies</strong><p>Nothing is currently marked as waiting.</p></div> :
            <div className="waiting-groups">{groupedWaiting.map(([key, group], index) => {
              const kind = group[0].intelligence?.waitingOnType ?? 'OTHER';
              const name = group[0].intelligence?.waitingOnName?.trim() || (kind === 'TEAM' ? 'Unspecified team member' : kind === 'CLIENT' ? 'Unspecified client contact' : kind === 'VENDOR' ? 'Unspecified vendor' : 'Unspecified owner');
              return <details className="waiting-person" key={key} open={index < 3}>
                <summary><span className="waiting-person-title"><strong>{name}</strong><small>{kind === 'TEAM' ? 'Team' : kind === 'CLIENT' ? 'Client' : kind === 'VENDOR' ? 'Vendor' : 'Other dependency'}</small></span><span className="panel-count">{group.length}</span></summary>
                <div className="clean-task-list">{group.map(task => <article className="clean-task" key={task.id}>
                  <div className="task-topline"><span>{task.client.name}</span>{task.intelligence?.needsAmi && <span className="status-pill attention-pill">Also needs Ami</span>}</div>
                  <h3>{task.name}</h3><p className="next-step-label">What we're waiting for</p><p>{task.intelligence?.currentSummary || 'Awaiting an update.'}</p>
                  <TaskDetailsButton taskId={task.id} />{task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noreferrer">Open in ClickUp ↗</a>}
                </article>)}</div>
              </details>;
            })}</div>}
        </section>
      </div>

      <aside className="dashboard-sidebar">
        <section className="clean-panel" id="clients" aria-labelledby="clients-title">
          <div className="panel-heading"><div><p className="eyebrow">AT A GLANCE</p><h2 id="clients-title">How are our clients doing?</h2></div><span className="panel-count">{orderedClients.length}</span></div>
          <div className="entity-list">{orderedClients.map(([slug,client]) => <a className="entity-row" key={slug} href={`/clients/${slug}`}><span className="entity-avatar">{client.name.slice(0,1).toUpperCase()}</span><span className="entity-copy"><strong>{client.name}</strong><small>{client.total} imported · {client.analyzed} analyzed · {client.waiting} waiting</small></span>{client.needsAmi > 0 && <span className="entity-alert">{client.needsAmi} for Ami</span>}<span className="entity-arrow">›</span></a>)}</div>
        </section>
        {unattributedFolders.length > 0 && <details className="clean-panel collapsible-panel">
          <summary>Invoiced folders awaiting client assignment <span>{unattributedFolders.length}</span></summary>
          <p className="section-explainer">These ClickUp folders have generic names, so we cannot safely identify their client. Their tasks remain imported and accessible, but they are not counted as separate clients.</p>
          <div className="entity-list">{unattributedFolders.map(([slug, folder]) => <a className="entity-row" key={slug} href={`/clients/${slug}`}><span className="entity-avatar">?</span><span className="entity-copy"><strong>{folder.name}</strong><small>{folder.total} imported tasks · Identify client before grouping</small></span><span className="entity-arrow">›</span></a>)}</div>
        </details>}
        <section className="clean-panel" id="team" aria-labelledby="team-title">
          <div className="panel-heading"><div><p className="eyebrow">WORKLOAD</p><h2 id="team-title">Team</h2></div><span className="panel-count">{orderedEmployees.length}</span></div>
          <div className="entity-list">{orderedEmployees.map(([name,employee]) => <a className="entity-row" key={employee.id} href={`/employees/${employee.id}`}><span className="entity-avatar team-avatar">{name.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase()}</span><span className="entity-copy"><strong>{name}</strong><small>{employee.total} assigned · {employee.waiting} waiting</small></span><span className="entity-arrow">›</span></a>)}</div>
        </section>
        <div className="dashboard-note">Intelligence is inferred from ClickUp tasks and comments. Open a task to verify its latest details.</div>
      </aside>
    </div>
  </main>;
}
