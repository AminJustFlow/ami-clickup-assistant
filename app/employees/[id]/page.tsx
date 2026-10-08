import { isStaleActive, activityLabel } from '@/lib/intelligence/staleness';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';

export const dynamic = 'force-dynamic';

const label: Record<string,string> = {
  WAITING_ON_AMI:'Waiting on Ami', WAITING_ON_TEAM:'Waiting on team', WAITING_ON_CLIENT:'Waiting on client',
  WAITING_ON_VENDOR:'Waiting on vendor', BLOCKED:'Blocked', ISSUE:'Issue', ACTIVE:'Active', COMPLETED:'Completed',
  NEEDS_REVIEW:'Needs review', NOT_STARTED:'Not started', UNKNOWN:'Unknown'
};

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const { q = '' } = await searchParams;
  const search = q.trim().toLocaleLowerCase();
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) notFound();

  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null }, assignees: { some: { employeeId } } },
    include: { client: true, intelligence: true, list: true, comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } }, assignees: { include: { employee: true } } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const needsAmi = tasks.filter(t => t.intelligence?.needsAmi);
  const waiting = tasks.filter(t => t.intelligence?.waitingOnType !== 'NONE' && t.intelligence?.waitingOnType !== 'AMI');
  const active = tasks.filter(t => t.intelligence?.agentState === 'ACTIVE');
  const stale = active.filter(t => isStaleActive({ state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }));
  const recentActive = active.filter(t => !stale.includes(t));

  const matches = (t: typeof tasks[number]) => !search || [t.name, t.client.name, t.list.name, t.intelligence?.currentSummary ?? '', t.intelligence?.amiAction ?? ''].some(value => value.toLocaleLowerCase().includes(search));
  const shownNeedsAmi = needsAmi.filter(matches);
  const shownWaiting = waiting.filter(matches);
  const shownRecent = recentActive.filter(matches);
  const shownStale = stale.filter(matches);
  const notStarted = tasks.filter(t => t.intelligence?.agentState === 'NOT_STARTED' && matches(t));
  const completed = tasks.filter(t => t.intelligence?.agentState === 'COMPLETED' && matches(t));
  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="team" />
    <header className="detail-hero"><div><a className="back-link" href="/#team">← All team members</a><p className="eyebrow">TEAM MEMBER</p><h1>{employee.name}</h1><p>Workload, blockers, and recent progress in one place.</p></div></header>
    <div className="detail-stat-strip"><div><strong>{tasks.length}</strong><span>Assigned</span></div><div><strong>{needsAmi.length}</strong><span>Need Ami</span></div><div><strong>{waiting.length}</strong><span>Waiting</span></div><div><strong>{active.length}</strong><span>In progress</span></div></div>
    <form className="filter-bar clean-filters" method="GET"><label className="search-label">Find a task<input type="search" name="q" defaultValue={q} placeholder="Search tasks, clients, or summaries…" /></label><button type="submit">Search</button><a href={`/employees/${employeeId}`}>Clear</a></form>
    <p className="filter-results">{tasks.filter(matches).length} of {tasks.length} assigned tasks match</p>
    <div className="detail-sections">
      {shownNeedsAmi.length > 0 && <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">PRIORITY</p><h2>Needs Ami</h2></div><span className="panel-count">{shownNeedsAmi.length}</span></div><div className="clean-task-list">{shownNeedsAmi.map(t => <TaskCard key={t.id} task={t} />)}</div></section>}
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">DEPENDENCIES</p><h2>Waiting on someone</h2></div><span className="panel-count">{shownWaiting.length}</span></div><div className="clean-task-list">{shownWaiting.length ? shownWaiting.map(t => <TaskCard key={t.id} task={t} />) : <p className="simple-empty">No outstanding dependencies.</p>}</div></section>
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">IN MOTION</p><h2>Recently active</h2></div><span className="panel-count">{shownRecent.length}</span></div><div className="clean-task-list">{shownRecent.length ? shownRecent.map(t => <TaskCard key={t.id} task={t} />) : <p className="simple-empty">No recently active tasks.</p>}</div></section>
      <details className="clean-panel collapsible-panel"><summary>Stale active <span>{shownStale.length}</span></summary><p className="section-explainer">No activity recorded in 30 days; work may still be underway.</p><div className="clean-task-list">{shownStale.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
      <details className="clean-panel collapsible-panel"><summary>Not started <span>{notStarted.length}</span></summary><div className="clean-task-list">{notStarted.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
      <details className="clean-panel collapsible-panel"><summary>Completed <span>{completed.length}</span></summary><div className="clean-task-list">{completed.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
    </div>
  </main>;
}

function TaskCard({ task }: { task: any }) {
  const intel = task.intelligence;
  return <article className="clean-task">
    <div className="task-topline"><span>{task.client.name}</span><span className="status-pill">{label[intel.agentState] ?? intel.agentState}</span></div>
    {intel.needsAmi && intel.amiAction && <div className="task-decision"><strong>Ami needs to decide</strong><p>{intel.amiAction}</p></div>}<h3 className="task-context-title">{task.name}</h3>{intel.currentSummary && <p>{intel.currentSummary}</p>}
    <div className="task-footer"><span>{intel.waitingOnName ? 'Waiting on ' + intel.waitingOnName : activityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any)=>[c.clickupCreatedAt,c.clickupUpdatedAt]) })}</span>{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open in ClickUp ↗</a>}</div>
  </article>;
}
