import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const waitingStates = ['WAITING_ON_AMI', 'WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'BLOCKED', 'ISSUE'];

export default async function Home() {
  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null } },
    include: {
      client: true,
      list: true,
      intelligence: true,
      assignees: { include: { employee: true } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });

  const needsAmi = tasks.filter((task) => task.intelligence?.needsAmi);
  const waiting = tasks.filter((task) => task.intelligence && waitingStates.includes(task.intelligence.agentState));
  const active = tasks.filter((task) => task.intelligence?.agentState === 'ACTIVE');

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

  const card: React.CSSProperties = { border: '1px solid #d7dce2', borderRadius: 10, padding: 18, background: '#fff' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) repeat(3, minmax(70px, 1fr))', gap: 12, padding: '10px 0', borderTop: '1px solid #e5e7eb', alignItems: 'center' };

  return <main style={{ maxWidth: 1250, margin: '0 auto', padding: 24 }}>
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Ami Operations Intelligence</h1>
      <p className="muted">Current operational reality derived from ClickUp activity. ClickUp remains the source of truth.</p>
    </div>

    <section style={grid}>
      <div style={card}><strong>Needs Ami</strong><div style={{ fontSize: 34, fontWeight: 700 }}>{needsAmi.length}</div><small>Concrete decisions or actions</small></div>
      <div style={card}><strong>Waiting / Blocked</strong><div style={{ fontSize: 34, fontWeight: 700 }}>{waiting.length}</div><small>Team, client, vendor, or issue</small></div>
      <div style={card}><strong>Active</strong><div style={{ fontSize: 34, fontWeight: 700 }}>{active.length}</div><small>Work currently moving</small></div>
      <div style={card}><strong>Analyzed Tasks</strong><div style={{ fontSize: 34, fontWeight: 700 }}>{tasks.length}</div><small>Stored intelligence records</small></div>
    </section>

    <section style={{ ...card, marginTop: 22 }}>
      <h2>Needs Ami</h2>
      {!needsAmi.length && <p className="muted">Nothing currently requires Ami&apos;s action.</p>}
      {needsAmi.slice(0, 12).map((task) => {
        const intel = task.intelligence!;
        return <article key={task.id} style={{ borderTop: '1px solid #e5e7eb', padding: '14px 0' }}>
          <strong>{task.client.name} · {task.name}</strong>
          <p style={{ margin: '6px 0' }}>{intel.amiAction ?? intel.currentSummary}</p>
          <small>{intel.headline} · attention {intel.amiAttentionScore}/100 · confidence {intel.confidence == null ? '—' : Math.round(intel.confidence * 100) + '%'}</small>
          {task.clickupUrl && <> · <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open ClickUp</a></>}
        </article>;
      })}
    </section>

    <div style={{ ...grid, marginTop: 22 }}>
      <section style={card}>
        <h2>Clients</h2>
        <div style={{ ...rowStyle, fontWeight: 700 }}><span>Client</span><span>Ami</span><span>Waiting</span><span>Active</span></div>
        {[...clientRows.entries()].sort((a,b) => b[1].needsAmi - a[1].needsAmi || b[1].waiting - a[1].waiting).map(([slug, row]) =>
          <div key={slug} style={rowStyle}><span><strong>{row.name}</strong><br/><small>{row.total} analyzed</small></span><span>{row.needsAmi}</span><span>{row.waiting}</span><span>{row.active}</span></div>
        )}
      </section>

      <section style={card}>
        <h2>Employees</h2>
        <div style={{ ...rowStyle, fontWeight: 700 }}><span>Employee</span><span>Ami</span><span>Waiting</span><span>Owned</span></div>
        {[...employeeRows.entries()].sort((a,b) => b[1].needsAmi - a[1].needsAmi || b[1].waiting - a[1].waiting).map(([name, row]) =>
          <div key={name} style={rowStyle}><span><strong>{name}</strong></span><span>{row.needsAmi}</span><span>{row.waiting}</span><span>{row.total}</span></div>
        )}
      </section>
    </div>

    <section style={{ ...card, marginTop: 22 }}>
      <h2>Waiting and Blocked</h2>
      {waiting.slice(0, 20).map((task) => {
        const intel = task.intelligence!;
        return <article key={task.id} style={{ borderTop: '1px solid #e5e7eb', padding: '12px 0' }}>
          <strong>{task.client.name} · {task.name}</strong>
          <div>{intel.agentState}{intel.waitingOnName ? ` · ${intel.waitingOnName}` : ''}</div>
          <small>{intel.currentSummary}</small>
        </article>;
      })}
    </section>

    <p style={{ marginTop: 22 }}><a href="/debug/voth/intelligence">Open VOTH intelligence evidence view</a></p>
  </main>;
}
