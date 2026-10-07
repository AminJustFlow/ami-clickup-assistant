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

const waitOrder = ['WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'BLOCKED', 'ISSUE'];

export default async function Home() {
  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null } },
    include: {
      client: true,
      intelligence: true,
      assignees: { include: { employee: true } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });

  const needsAmi = tasks.filter((task) => task.intelligence?.needsAmi);
  const waiting = tasks.filter((task) => task.intelligence && waitingStates.includes(task.intelligence.agentState));
  const active = tasks.filter((task) => task.intelligence?.agentState === 'ACTIVE');
  const completed = tasks.filter((task) => task.intelligence?.agentState === 'COMPLETED');

  const clientRows = new Map<string, { name: string; total: number; needsAmi: number; waiting: number; active: number }>();
  for (const task of tasks) {
    const row = clientRows.get(task.client.slug) ?? { name: task.client.name, total: 0, needsAmi: 0, waiting: 0, active: 0 };
    row.total += 1;
    if (task.intelligence?.needsAmi) row.needsAmi += 1;
    if (task.intelligence && waitingStates.includes(task.intelligence.agentState)) row.waiting += 1;
    if (task.intelligence?.agentState === 'ACTIVE') row.active += 1;
    clientRows.set(task.client.slug, row);
  }

  const employeeRows = new Map<string, { total: number; waiting: number; needsAmi: number }>();
  for (const task of tasks) {
    for (const { employee } of task.assignees) {
      const row = employeeRows.get(employee.name) ?? { total: 0, waiting: 0, needsAmi: 0 };
      row.total += 1;
      if (task.intelligence && waitingStates.includes(task.intelligence.agentState)) row.waiting += 1;
      if (task.intelligence?.needsAmi) row.needsAmi += 1;
      employeeRows.set(employee.name, row);
    }
  }

  const waitingGroups = waitOrder
    .map((state) => ({ state, tasks: waiting.filter((task) => task.intelligence?.agentState === state) }))
    .filter((group) => group.tasks.length);

  return <main className="ops-shell">
    <header className="ops-header">
      <div>
        <p className="eyebrow">JUST FLOW · OPERATIONS</p>
        <h1>Ami Intelligence</h1>
        <p className="muted">What needs attention now, what is waiting, and where work stands.</p>
      </div>
      <a className="secondary-link" href="/debug/voth/intelligence">Evidence view</a>
    </header>

    <section className="attention-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PRIORITY</p>
          <h2>Needs your attention</h2>
        </div>
        <span className="count-badge attention-count">{needsAmi.length}</span>
      </div>

      {!needsAmi.length && <div className="empty-state">Nothing currently requires your decision or action.</div>}
      {needsAmi.map((task) => {
        const intel = task.intelligence!;
        return <article className="attention-card" key={task.id}>
          <div className="task-kicker">{task.client.name}</div>
          <h3>{task.name}</h3>
          <p className="action-copy">{intel.amiAction ?? intel.currentSummary}</p>
          <div className="task-meta">
            <span>{Math.round((intel.confidence ?? 0) * 100)}% confidence</span>
            {task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open in ClickUp →</a>}
          </div>
        </article>;
      })}
    </section>

    <section className="metric-grid">
      <div className="metric-card"><span>Waiting</span><strong>{waiting.length}</strong><small>External or team dependencies</small></div>
      <div className="metric-card"><span>Active</span><strong>{active.length}</strong><small>Currently moving</small></div>
      <div className="metric-card"><span>Completed</span><strong>{completed.length}</strong><small>Operationally complete</small></div>
      <div className="metric-card"><span>Analyzed</span><strong>{tasks.length}</strong><small>Tasks with current intelligence</small></div>
    </section>

    <section className="ops-section">
      <div className="section-heading">
        <div><p className="eyebrow">DEPENDENCIES</p><h2>What we&apos;re waiting on</h2></div>
        <span className="count-badge">{waiting.filter((task) => !task.intelligence?.needsAmi).length}</span>
      </div>

      <div className="waiting-grid">
        {waitingGroups.map((group) => <div className="waiting-group" key={group.state}>
          <div className="waiting-group-title">
            <h3>{stateLabel[group.state] ?? group.state}</h3>
            <span>{group.tasks.length}</span>
          </div>
          {group.tasks.slice(0, 6).map((task) => {
            const intel = task.intelligence!;
            return <article className="compact-task" key={task.id}>
              <div className="task-kicker">{task.client.name}</div>
              <strong>{task.name}</strong>
              <p>{intel.currentSummary}</p>
              <small>{intel.waitingOnName ? `Waiting on ${intel.waitingOnName}` : stateLabel[intel.agentState]}</small>
            </article>;
          })}
          {group.tasks.length > 6 && <div className="more-row">+ {group.tasks.length - 6} more</div>}
        </div>)}
      </div>
    </section>

    <section className="split-grid">
      <div className="ops-section">
        <div className="section-heading"><div><p className="eyebrow">CLIENTS</p><h2>Client overview</h2></div></div>
        <div className="summary-table">
          <div className="summary-row summary-head"><span>Client</span><span>Ami</span><span>Waiting</span><span>Active</span></div>
          {[...clientRows.entries()].sort((a,b) => b[1].needsAmi - a[1].needsAmi || b[1].waiting - a[1].waiting).map(([slug, row]) =>
            <div className="summary-row" key={slug}>
              <span><strong>{row.name}</strong><small>{row.total} analyzed</small></span>
              <span>{row.needsAmi}</span><span>{row.waiting}</span><span>{row.active}</span>
            </div>
          )}
        </div>
      </div>

      <div className="ops-section">
        <div className="section-heading"><div><p className="eyebrow">TEAM</p><h2>Employee overview</h2></div></div>
        <div className="summary-table">
          <div className="summary-row summary-head"><span>Employee</span><span>Ami</span><span>Waiting</span><span>Owned</span></div>
          {[...employeeRows.entries()].sort((a,b) => b[1].needsAmi - a[1].needsAmi || b[1].waiting - a[1].waiting).map(([name, row]) =>
            <div className="summary-row" key={name}>
              <span><strong>{name}</strong></span><span>{row.needsAmi}</span><span>{row.waiting}</span><span>{row.total}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  </main>;
}
