import { isStaleActive, activityLabel, humanActivityLabel } from '@/lib/intelligence/staleness';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const label: Record<string,string> = {
  WAITING_ON_AMI:'Waiting on Ami', WAITING_ON_TEAM:'Waiting on team', WAITING_ON_CLIENT:'Waiting on client',
  WAITING_ON_VENDOR:'Waiting on vendor', BLOCKED:'Blocked', ISSUE:'Issue', ACTIVE:'Active', COMPLETED:'Completed',
  NEEDS_REVIEW:'Needs review', NOT_STARTED:'Not started', UNKNOWN:'Unknown'
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignee?: string; age?: string; status?: string }> }) {
  const { slug } = await params;
  const filters = await searchParams;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false, intelligence: { isNot: null } },
    include: { intelligence: true, list: true, comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } }, assignees: { include: { employee: true } } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const needsAmi = tasks.filter(t => t.intelligence?.needsAmi);
  const waiting = tasks.filter(t => t.intelligence?.waitingOnType !== 'NONE' && !t.intelligence?.needsAmi);
  const active = tasks.filter(t => t.intelligence?.agentState === 'ACTIVE');

  const assigneeOptions = [...new Map(tasks.flatMap(t => t.assignees.map(a => [String(a.employee.id), { id: String(a.employee.id), name: a.employee.name }] as const))).values()].sort((a,b) => a.name.localeCompare(b.name));
  const matches = (t: typeof tasks[number]) => {
    if (filters.assignee && !t.assignees.some(a => String(a.employee.id) === filters.assignee)) return false;
    if (filters.status && t.status.toLowerCase() !== filters.status.toLowerCase()) return false;
    if (filters.age === '30' && !isStaleActive({ state: t.intelligence?.agentState ?? '', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) })) return false;
    if (filters.age === 'recent' && isStaleActive({ state: t.intelligence?.agentState ?? '', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) })) return false;
    return true;
  };
  const visibleWaiting = waiting.filter(matches);
  const visibleNeedsAmi = needsAmi.filter(matches);
  const stale = active.filter(t => isStaleActive({ state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }));
  const recentActive = active.filter(t => !stale.includes(t));

  const visibleRecent = recentActive.filter(matches);
  const visibleStale = stale.filter(matches);
  const statusOptions = [...new Set(tasks.map(t => t.status))].sort();

  return <main className="ops-shell">
    <a className="back-link" href="/">← Ami Intelligence</a>
    <header className="detail-header"><p className="eyebrow">CLIENT INTELLIGENCE</p><h1>{client.name}</h1><p className="muted">{tasks.length} analyzed tasks · {needsAmi.length} need Ami · {waiting.length} waiting · {recentActive.length} recently active · {stale.length} stale</p></header>

    <form className="filter-bar" method="GET"><label>Assignee<select name="assignee" defaultValue={filters.assignee ?? ""}><option value="">All assignees</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>ClickUp status<select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{statusOptions.map(s => <option key={s} value={s}>{s}</option>)}</select></label><label>Activity age<select name="age" defaultValue={filters.age ?? ""}><option value="">Any age</option><option value="recent">Updated within 30 days</option><option value="30">Stale active (30+ days)</option></select></label><button type="submit">Apply filters</button><a href={`/clients/${slug}`}>Clear</a></form>
    {!!visibleNeedsAmi.length && <section className="attention-section"><div className="section-heading"><h2>Needs Ami</h2><span className="count-badge attention-count">{visibleNeedsAmi.length}</span></div>{visibleNeedsAmi.map(t => <TaskCard key={t.id} task={t} />)}</section>}

    <section className="detail-grid">
      <div className="ops-section"><div className="section-heading"><h2>Waiting</h2><span className="count-badge">{visibleWaiting.length}</span></div>{visibleWaiting.map(t => <TaskCard key={t.id} task={t} />)}</div>
      <div className="ops-section"><div className="section-heading"><h2>Recently active</h2><span className="count-badge">{visibleRecent.length}</span></div>{visibleRecent.slice(0,20).map(t => <TaskCard key={t.id} task={t} compact />)}{visibleRecent.length > 20 && <p className="muted">+ {visibleRecent.length - 20} more recently active tasks</p>}</div>
    </section>
    <details className="ops-section" style={{ marginTop: 18 }}><summary className="section-heading"><div><p className="eyebrow">REVIEW SIGNAL · 30 DAYS</p><h2>Stale active tasks ({visibleStale.length})</h2></div></summary><p className="muted">No task or comment update in 30 days. This does not prove the work stopped.</p>{visibleStale.map(t => <TaskCard key={t.id} task={t} compact />)}</details>
  </main>;
}

function TaskCard({ task, compact=false }: { task: any; compact?: boolean }) {
  const intel = task.intelligence;
  return <article className="detail-task"><div className="task-kicker">{task.list.name} · {label[intel.agentState] ?? intel.agentState}</div><strong>{task.name}</strong>{!compact && <p>{intel.currentSummary}</p>}<div className="task-meta"><span>{activityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any) => [c.clickupCreatedAt, c.clickupUpdatedAt]) })}</span><span>{humanActivityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any) => [c.clickupCreatedAt, c.clickupUpdatedAt]) })}</span><span>{task.assignees.map((a:any)=>a.employee.name).join(', ') || 'Unassigned'}</span>{intel.waitingOnName && <span>Waiting on {intel.waitingOnName}</span>}{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">ClickUp →</a>}</div></article>;
}
