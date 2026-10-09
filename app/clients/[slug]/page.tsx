import { TaskDetailsButton } from '../../components/task-details';
import { progressSignal } from '@/lib/intelligence/progress';
import { isStaleActive, activityLabel, humanActivityLabel } from '@/lib/intelligence/staleness';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';
import { foldersForClient } from '@/lib/clients/grouping';

export const dynamic = 'force-dynamic';

const label: Record<string,string> = {
  WAITING_ON_AMI:'Waiting on Ami', WAITING_ON_TEAM:'Waiting on team', WAITING_ON_CLIENT:'Waiting on client',
  WAITING_ON_VENDOR:'Waiting on vendor', BLOCKED:'Blocked', ISSUE:'Issue', ACTIVE:'Active', COMPLETED:'Completed',
  NEEDS_REVIEW:'Needs review', NOT_STARTED:'Not started', UNKNOWN:'Unknown'
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignee?: string; age?: string; status?: string; q?: string }> }) {
  const { slug } = await params;
  const filters = await searchParams;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();

  const allClientFolders = await prisma.client.findMany({ where: { active: true }, select: { id: true, slug: true, name: true } });
  const relatedFolders = foldersForClient(allClientFolders, slug);
  const tasks = await prisma.task.findMany({
    where: { clientId: { in: relatedFolders.map(folder => folder.id) }, deleted: false },
    include: { client: { select: { name: true } }, intelligence: true, list: true, comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true, body: true, authorName: true } }, events: { orderBy: { occurredAt: 'desc' }, take: 15 }, assignees: { include: { employee: true } } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const unanalyzed = tasks.filter(t => !t.intelligence);
  const needsAmi = tasks.filter(t => t.intelligence?.needsAmi);
  const waiting = tasks.filter(t => t.intelligence?.waitingOnType !== 'NONE' && t.intelligence?.waitingOnType !== 'AMI');
  const active = tasks.filter(t => t.intelligence?.agentState === 'ACTIVE');

  const assigneeOptions = [...new Map(tasks.flatMap(t => t.assignees.map(a => [String(a.employee.id), { id: String(a.employee.id), name: a.employee.name }] as const))).values()].sort((a,b) => a.name.localeCompare(b.name));
  const search = (filters.q ?? '').trim().toLocaleLowerCase();
  const matches = (t: typeof tasks[number]) => {
    if (search && ![t.name, t.list.name, t.intelligence?.currentSummary ?? '', t.intelligence?.amiAction ?? '', ...t.assignees.map(a => a.employee.name)].some(value => value.toLocaleLowerCase().includes(search))) return false;
    if (filters.assignee && !t.assignees.some(a => String(a.employee.id) === filters.assignee)) return false;
    if (filters.status && (t.clickupStatus ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;
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
  const visibleNotStarted = tasks.filter(t => t.intelligence?.agentState === 'NOT_STARTED' && matches(t));
  const visibleCompleted = tasks.filter(t => t.intelligence?.agentState === 'COMPLETED' && matches(t));
  const visibleUnanalyzed = unanalyzed.filter(matches);
  const statusOptions = [...new Set(tasks.map(t => t.clickupStatus).filter((s): s is string => Boolean(s)))].sort();

  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="clients" />
    <header className="detail-hero"><div><a className="back-link" href="/#clients">← All clients</a><p className="eyebrow">CLIENT OVERVIEW</p><h1>{relatedFolders[0]?.name ?? client.name}</h1><p>Understand what needs attention and what the team is working on.</p></div></header>
    {relatedFolders.length > 1 && <section className="clean-panel"><p className="eyebrow">CONSOLIDATED CLIENT VIEW</p><p>Showing {relatedFolders.length} original ClickUp folders together. Billing and no-go records remain separate from operational approvals.</p><p>{relatedFolders.map(folder => folder.name).join(' · ')}</p></section>}
    <div className="detail-stat-strip">
      <div><strong>{tasks.length}</strong><span>Imported tasks</span></div>
      <div><strong>{needsAmi.length}</strong><span>Need Ami</span></div>
      <div><strong>{waiting.length}</strong><span>Waiting</span></div>
      <div><strong>{active.length}</strong><span>In progress</span></div>
    </div>
    <form className="filter-bar clean-filters" method="GET">
      <label className="search-label">Find a task<input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Search tasks, people, or summaries…" /></label>
      <label>Team member<select name="assignee" defaultValue={filters.assignee ?? ""}><option value="">Everyone</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>ClickUp status<select name="status" defaultValue={filters.status ?? ""}><option value="">Any status</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>Activity<select name="age" defaultValue={filters.age ?? ""}><option value="">Any time</option><option value="recent">Recently active</option><option value="30">Stale active</option></select></label>
      <button type="submit">Show results</button><a href={`/clients/${slug}`}>Clear filters</a>
    </form>
    <p className="filter-results">{tasks.filter(matches).length} of {tasks.length} tasks match your filters</p>
    {unanalyzed.length > 0 && <p className="sync-status sync-status-warning">{unanalyzed.length} imported tasks are awaiting AI analysis. Decision and dependency totals include only analyzed tasks.</p>}
    <div className="detail-sections">
      {visibleNeedsAmi.length > 0 && <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">PRIORITY</p><h2>Needs Ami</h2></div><span className="panel-count">{visibleNeedsAmi.length}</span></div><div className="clean-task-list">{visibleNeedsAmi.map(t => <TaskCard key={t.id} task={t} />)}</div></section>}
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">DEPENDENCIES</p><h2>Waiting on someone</h2></div><span className="panel-count">{visibleWaiting.length}</span></div><div className="clean-task-list">{visibleWaiting.length ? visibleWaiting.map(t => <TaskCard key={t.id} task={t} />) : <p className="simple-empty">No tasks waiting on others.</p>}</div></section>
      <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">IN MOTION</p><h2>Recently active</h2></div><span className="panel-count">{visibleRecent.length}</span></div><div className="clean-task-list">{visibleRecent.length ? visibleRecent.map(t => <TaskCard key={t.id} task={t} />) : <p className="simple-empty">No recently active tasks match your filters.</p>}</div></section>
      {visibleUnanalyzed.length > 0 && <details className="clean-panel collapsible-panel" open={tasks.length === unanalyzed.length}><summary>Imported — awaiting AI analysis <span>{visibleUnanalyzed.length}</span></summary><div className="clean-task-list">{visibleUnanalyzed.map(t => <article className="clean-task" key={t.id}><div className="task-topline"><span>{t.client.name} / {t.list.name}</span><span className="status-pill">{t.clickupStatus || 'Imported'}</span></div><h3>{t.name}</h3><div className="task-footer"><span>{t.assignees.map(a => a.employee.name).join(', ') || 'Unassigned'}</span><TaskDetailsButton taskId={t.id} /></div></article>)}</div></details>}
      <details className="clean-panel collapsible-panel"><summary>Stale active <span>{visibleStale.length}</span></summary><p className="section-explainer">No recorded activity in 30 days. This does not necessarily mean work stopped.</p><div className="clean-task-list">{visibleStale.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
      <details className="clean-panel collapsible-panel"><summary>Not started <span>{visibleNotStarted.length}</span></summary><div className="clean-task-list">{visibleNotStarted.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
      <details className="clean-panel collapsible-panel"><summary>Completed <span>{visibleCompleted.length}</span></summary><div className="clean-task-list">{visibleCompleted.map(t => <TaskCard key={t.id} task={t} />)}</div></details>
    </div>
  </main>;
}

function TaskCard({ task }: { task: any }) {
  const intel = task.intelligence;
  const progress = progressSignal({ agentState: intel.agentState, clickupStatus: task.clickupStatus, comments: task.comments, events: task.events, lastMeaningfulChangeAt: intel.lastMeaningfulChangeAt, lastMeaningfulChange: intel.lastMeaningfulChange });
  return <article className="clean-task">
    <div className="task-topline"><span>{task.client.name} / {task.list.name}</span><span className="status-pill">{label[intel.agentState] ?? intel.agentState}</span></div>
    {intel.needsAmi && intel.amiAction && <div className="task-decision"><strong>Ami needs to decide</strong><p>{intel.amiAction}</p></div>}
    <h3 className="task-context-title">{task.name}</h3>
    {intel.currentSummary && <p>{intel.currentSummary}</p>}
    <div className="task-footer"><span>{task.assignees.map((a:any)=>a.employee.name).join(', ') || 'Unassigned'}{intel.waitingOnName ? ' · Waiting on ' + intel.waitingOnName : ''}</span><TaskDetailsButton taskId={task.id} />{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open in ClickUp ↗</a>}</div>
    <details className="task-extra"><summary>Context and evidence</summary><p>{progress.label}: {progress.detail}</p><p>{activityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any)=>[c.clickupCreatedAt,c.clickupUpdatedAt]) })} · {humanActivityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any)=>[c.clickupCreatedAt,c.clickupUpdatedAt]) })}</p>{task.comments.length > 0 && <div className="evidence-comments"><strong>Recent ClickUp comments</strong>{task.comments.slice(-4).reverse().map((comment:any,index:number) => <div className="evidence-comment" key={index}><div className="comment-byline"><strong>{comment.authorName?.trim() || 'Unknown author'}</strong><small>{comment.clickupCreatedAt ? new Date(comment.clickupCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated'}</small></div><p>{comment.body}</p></div>)}</div>}</details>
  </article>;
}
