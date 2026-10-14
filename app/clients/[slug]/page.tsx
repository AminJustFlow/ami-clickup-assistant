import { isStaleActive } from '@/lib/intelligence/staleness';
import { isOpenAttentionTask, isClosedClickUpStatus } from '@/lib/attention/triage';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../../components/app-nav';
import { TaskDetailsButton } from '../../components/task-details';
import { CompactTaskSection } from '../../components/compact-task-list';
import { foldersForClient } from '@/lib/clients/grouping';

export const dynamic = 'force-dynamic';

type Filters = { assignee?: string; age?: string; due?: string; focus?: string; view?: string; status?: string; sort?: string; q?: string; section?: string; page?: string };

export default async function ClientPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Filters>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();
  const allClientFolders = await prisma.client.findMany({
    where: { active: true, clickupSpaceId: client.clickupSpaceId },
    select: { id: true, slug: true, name: true, clickupFolderId: true }
  });
  const relatedFolders = foldersForClient(allClientFolders, slug);
  const tasks = await prisma.task.findMany({
    where: { clientId: { in: relatedFolders.map(folder => folder.id) }, deleted: false },
    select: {
      id: true, name: true, clickupStatus: true, clickupPriority: true,
      dueDate: true, clickupUpdatedAt: true, clickupUrl: true,
      client: { select: { name: true, slug: true } },
      intelligence: true,
      attentionDisposition: { select: { sourceFingerprint: true, decision: true } },
      list: { select: { name: true } },
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
      events: { orderBy: { occurredAt: 'desc' }, take: 1, select: { eventType: true, actorName: true, occurredAt: true } },
      assignees: { select: { employee: { select: { id: true, name: true } } } }
    },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const assigneeOptions = [...new Map(tasks.flatMap(t => t.assignees.map(a =>
    [String(a.employee.id), { id: String(a.employee.id), name: a.employee.name }] as const
  ))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const statusOptions = [...new Set(tasks.map(t => t.clickupStatus).filter((s): s is string => Boolean(s)))].sort();
  const search = (filters.q ?? '').trim().toLowerCase();
  const sort = ['priority', 'due', 'recent'].includes(filters.sort ?? '') ? filters.sort : 'priority';
  const now = new Date();
  const matches = (t: typeof tasks[number]) => {
    if (search && ![t.name, t.list.name, t.intelligence?.currentSummary ?? '',
      t.intelligence?.amiAction ?? '', ...t.assignees.map(a => a.employee.name)]
      .some(value => value.toLowerCase().includes(search))) return false;
    if (filters.assignee && !t.assignees.some(a => String(a.employee.id) === filters.assignee)) return false;
    if (filters.status && (t.clickupStatus ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;
    const stale = isStaleActive({
      state: t.intelligence?.agentState ?? '',
      taskUpdatedAt: t.clickupUpdatedAt,
      commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt])
    });
    if (filters.age === '30' && !stale) return false;
    if (filters.age === 'recent' && stale) return false;
    return true;
  };
  const filtered = tasks.filter(matches);
  const urgency = (t: typeof tasks[number]) => {
    const overdue = Boolean(t.dueDate && t.dueDate < now && !isClosedClickUpStatus(t.clickupStatus));
    const dueSoon = Boolean(t.dueDate && t.dueDate >= now && t.dueDate.getTime() - now.getTime() <= 7 * 86400000);
    const priority = (t.clickupPriority ?? '').toLowerCase();
    const score = (overdue ? 100 : dueSoon ? 40 : 0) + (priority === 'urgent' ? 35 : priority === 'high' ? 20 : 0) + (isOpenAttentionTask(t) ? 15 : 0);
    return score;
  };
  const prioritize = (items: typeof tasks) => [...items].sort((a, b) => sort === 'recent'
    ? (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0) || urgency(b) - urgency(a)
    : sort === 'due'
      ? (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || urgency(b) - urgency(a)
      : urgency(b) - urgency(a) || (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0));
  const allMatching = prioritize(filtered);
  const needsAmi = prioritize(filtered.filter(isOpenAttentionTask));
  const isClosed = (t: (typeof tasks)[number]) => t.intelligence?.agentState === 'COMPLETED' || isClosedClickUpStatus(t.clickupStatus);
  const waiting = prioritize(filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) &&
    t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI'));
  const inProgress = filtered.filter(t => !isOpenAttentionTask(t) && !isClosed(t) &&
    !waiting.includes(t) && t.intelligence?.agentState === 'ACTIVE');
  const stale = prioritize(inProgress.filter(t => isStaleActive({
    state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt,
    commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt])
  })));
  const recentlyActive = prioritize(inProgress.filter(t => !stale.includes(t)));
  const notStarted = filtered.filter(t => t.intelligence?.agentState === 'NOT_STARTED' && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const completed = filtered.filter(t => isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t));
  const unanalyzed = filtered.filter(t => !t.intelligence);
  const other = filtered.filter(t => t.intelligence && !isClosed(t) && !needsAmi.includes(t) && !waiting.includes(t) && !inProgress.includes(t) && !notStarted.includes(t));
  const analyzedCount = tasks.filter(t => t.intelligence).length;
  const openCount = tasks.filter(t => !isClosedClickUpStatus(t.clickupStatus)).length;
  const overdueTasks = prioritize(filtered.filter(t => !isClosedClickUpStatus(t.clickupStatus) && t.dueDate && t.dueDate < now));
  const overdueCount = tasks.filter(t => !isClosedClickUpStatus(t.clickupStatus) && t.dueDate && t.dueDate < now).length;
  const overdueRecent = overdueTasks.filter(t => t.clickupUpdatedAt && now.getTime() - t.clickupUpdatedAt.getTime() <= 30 * 86400000);
  const overdueOlder = overdueTasks.filter(t => !t.clickupUpdatedAt || now.getTime() - t.clickupUpdatedAt.getTime() > 30 * 86400000);
  const upcoming = tasks.filter(t => !isClosedClickUpStatus(t.clickupStatus) && t.dueDate && t.dueDate >= now && t.dueDate.getTime() <= now.getTime() + 7 * 86400000).sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));
  const recentChanges = [...tasks].filter(t => t.clickupUpdatedAt && t.clickupUpdatedAt <= now && now.getTime() - t.clickupUpdatedAt.getTime() <= 7 * 86400000).sort((a, b) => (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0));
  const recentEventLabel = (t: typeof tasks[number]) => {
    const event = t.events[0];
    if (!event?.occurredAt || !t.clickupUpdatedAt || Math.abs(event.occurredAt.getTime() - t.clickupUpdatedAt.getTime()) > 86400000) return 'Task updated in ClickUp · change type unavailable';
    const type = event.eventType.toLowerCase();
    const action = type.includes('comment') ? 'Comment activity' : type.includes('status') ? 'Status activity' : type.includes('assign') ? 'Assignment activity' : type.includes('due') ? 'Due-date activity' : 'Task activity';
    return action + (event.actorName ? ' · ' + event.actorName : '') + ' · ' + event.occurredAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const briefDecisions = prioritize(tasks.filter(isOpenAttentionTask));
  const briefDependencies = prioritize(tasks.filter(t => !isOpenAttentionTask(t) && !isClosedClickUpStatus(t.clickupStatus) && t.intelligence?.agentState !== 'COMPLETED' && t.intelligence?.waitingOnType && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI'));
  const briefDecision = briefDecisions[0];
  const briefDependency = briefDependencies[0];
  const briefDeadline = upcoming[0];
  const featuredTaskIds = new Set([briefDecision?.id, briefDependency?.id, briefDeadline?.id].filter((id): id is number => typeof id === 'number'));
  const additionalTasks = (items: typeof tasks) => items.filter(task => !featuredTaskIds.has(task.id));
  const hasFilters = Boolean(filters.q || filters.assignee || filters.status || filters.age);
  const currentNeedsAmi = tasks.filter(isOpenAttentionTask).length;
  const currentWaiting = tasks.filter(t => !isOpenAttentionTask(t) && !isClosedClickUpStatus(t.clickupStatus) && t.intelligence?.agentState !== 'COMPLETED' && t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI').length;
  const query = new URLSearchParams();
  for (const key of ['q', 'assignee', 'status', 'age', 'sort'] as const) if (filters[key]) query.set(key, filters[key]);
  const view: string = search ? 'all' : filters.view && ['ami', 'waiting', 'active', 'overdue', 'all'].includes(filters.view) ? filters.view : filters.due === 'overdue' || filters.focus === 'overdue' ? 'overdue' : 'ami';
  const tabHref = (nextView: string) => { const params = new URLSearchParams(query); params.set('view', nextView); params.delete('q'); params.delete('section'); params.delete('page'); return '?' + params.toString(); };
  query.set('view', view);
  const sectionProps = { section: filters.section, page: filters.page, query: query.toString() };

  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="clients" />
    <header className="detail-hero"><div><a className="back-link" href="/clients">← All clients</a>
      <p className="eyebrow">CLIENT OVERVIEW</p><h1>{relatedFolders[0]?.name ?? client.name}</h1>
      <p>Find decisions, blockers, and current work without scrolling through full AI reports.</p></div></header>
    {relatedFolders.length > 1 && <details className="clean-panel compact-intel-folders"><summary>{relatedFolders.length} ClickUp folders consolidated into this client</summary><p>{relatedFolders.map(folder => folder.name).join(' · ')}</p></details>}
    <div className="detail-stat-strip client-detail-priority-stats">
      <div><strong>{currentNeedsAmi}</strong><span>Needs Ami decisions · all</span></div>
      <div><strong>{currentWaiting}</strong><span>Waiting on someone · all</span></div>
      <div><strong>{openCount}</strong><span>Open-status tasks · all</span></div>
      <div><strong>{overdueCount}</strong><span>Past due open tasks · all</span></div>
    </div>
    <p className="dashboard-note client-detail-context">{tasks.length.toLocaleString()} imported tasks · {analyzedCount.toLocaleString()} AI analyzed. Open and overdue counts include older imported tasks. These are status-based indicators, not verified current workload.</p>
    <section className="client-action-brief clean-panel" aria-label="Client action brief">
      <div className="client-action-summary-heading"><div><p className="eyebrow">CLIENT ACTION BRIEF</p><h2>Where to focus first</h2></div><p>Suggested starting points from imported ClickUp tasks and unverified AI assessments. Confirm details before acting.</p></div>
      <div className="client-action-summary-grid">
        <div className="client-action-summary-card"><div className="client-action-summary-card-head"><h3>Decision to review</h3><strong>{briefDecisions.length}</strong></div>
          {briefDecision ? <><p><strong>{briefDecision.name}</strong></p><p className="dashboard-note">{briefDecision.intelligence?.amiAction || 'AI flagged this task for Ami to review.'}</p><TaskDetailsButton taskId={briefDecision.id} /></> : <p className="dashboard-note">No open Ami decisions identified.</p>}
          <a href={tabHref('ami')}>Review decisions →</a></div>
        <div className="client-action-summary-card"><div className="client-action-summary-card-head"><h3>Dependency to check</h3><strong>{briefDependencies.length}</strong></div>
          {briefDependency ? <><p><strong>{briefDependency.name}</strong></p><p className="dashboard-note">{briefDependency.intelligence?.waitingOnName ? 'AI identifies dependency: ' + briefDependency.intelligence.waitingOnName : 'AI identifies a dependency; owner not specified.'}</p><TaskDetailsButton taskId={briefDependency.id} /></> : <p className="dashboard-note">No open dependencies identified.</p>}
          <a href={tabHref('waiting')}>Review dependencies →</a></div>
        <div className="client-action-summary-card"><div className="client-action-summary-card-head"><h3>Next deadline</h3><strong>{upcoming.length}</strong></div>
          {briefDeadline?.dueDate ? <><p><strong>{briefDeadline.name}</strong></p><p className="dashboard-note">Due {briefDeadline.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {Math.ceil((briefDeadline.dueDate.getTime() - now.getTime()) / 86400000) <= 1 ? 'within 24 hours' : 'in ' + Math.ceil((briefDeadline.dueDate.getTime() - now.getTime()) / 86400000) + ' days'}</p><TaskDetailsButton taskId={briefDeadline.id} /></> : <p className="dashboard-note">No upcoming due dates within 7 days.</p>}
          <a href={tabHref('all') + '&sort=due'}>Review deadlines →</a></div>
      </div>
    </section>
    <section className="client-action-summary" aria-label="Client action summary">
      <div className="client-action-summary-heading"><div><p className="eyebrow">AT A GLANCE</p><h2>What needs attention</h2></div><p>Additional tasks not already featured above. Counts include all matching tasks; AI assessments are unverified.</p></div>
      <div className="client-action-summary-grid">
        {([
          { title: 'Decisions for Ami', items: prioritize(tasks.filter(isOpenAttentionTask)), count: currentNeedsAmi, view: 'ami', detail: (t: typeof tasks[number]) => t.intelligence?.amiAction || 'Review this task in ClickUp' },
          { title: 'Waiting on others', items: prioritize(tasks.filter(t => !isOpenAttentionTask(t) && !isClosed(t) && t.intelligence && t.intelligence.waitingOnType !== 'NONE' && t.intelligence.waitingOnType !== 'AMI')), count: currentWaiting, view: 'waiting', detail: (t: typeof tasks[number]) => t.intelligence?.waitingOnName ? 'Waiting on ' + t.intelligence.waitingOnName : 'Dependency identified by AI' },
          { title: 'Due in 7 days', items: upcoming, count: upcoming.length, view: 'all', detail: (t: typeof tasks[number]) => { if (!t.dueDate) return ''; const days = Math.ceil((t.dueDate.getTime() - now.getTime()) / 86400000); return (days <= 1 ? 'Due within 24 hours' : 'Due in ' + days + ' days') + ' · ' + t.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } },
          { title: 'Updated in 7 days', items: recentChanges, count: recentChanges.length, view: 'all', detail: recentEventLabel }
        ]).map(group => <div className="client-action-summary-card" key={group.title}>
          <div className="client-action-summary-card-head"><h3>{group.title}</h3><strong>{group.count}</strong></div>
          {additionalTasks(group.items).length ? <ul>{additionalTasks(group.items).slice(0, 3).map(t => <li key={t.id}><div><strong>{t.name}</strong><small>{group.detail(t)}</small></div><TaskDetailsButton taskId={t.id} /></li>)}</ul> : <p className="dashboard-note">{group.items.length ? "All matching tasks are highlighted above in the Client Action Brief." : "No matching items."}</p>}
          <a href={group.title === 'Updated in 7 days' ? tabHref('all') + '&sort=recent' : group.title === 'Due in 7 days' ? tabHref('all') + '&sort=due' : tabHref(group.view)}>{group.view === 'ami' ? 'View all decisions' : group.view === 'waiting' ? 'View all dependencies' : 'View all tasks'} →</a>
        </div>)}
      </div>
    </section>
    <nav className="client-workspace-tabs" aria-label="Client workspace views">
      <a aria-current={view === 'ami' ? 'page' : undefined} href={tabHref('ami')}>Needs Ami <span>{needsAmi.length}</span></a>
      <a aria-current={view === 'waiting' ? 'page' : undefined} href={tabHref('waiting')}>Waiting <span>{waiting.length}</span></a>
      <a aria-current={view === 'active' ? 'page' : undefined} href={tabHref('active')}>In progress <span>{recentlyActive.length + stale.length}</span></a>
      <a aria-current={view === 'overdue' ? 'page' : undefined} href={tabHref('overdue')}>Past due <span>{overdueCount}</span></a>
      <a aria-current={view === 'all' ? 'page' : undefined} href={tabHref('all')}>All tasks <span>{filtered.length}</span></a>
    </nav>
    {view === 'overdue' && <p className="dashboard-note client-due-filter-notice">Past-due tasks are based on stored ClickUp due dates and open statuses, not verified current workload. Recently updated tasks appear separately from older backlog. <a href={tabHref('all')}>Browse all tasks →</a></p>}
    <form className="filter-bar clean-filters" method="GET">
      <input type="hidden" name="view" value="all" />
      <label className="search-label">Find a task<input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Search tasks, people, or summaries…" /></label>
      <label>Team member<select name="assignee" defaultValue={filters.assignee ?? ''}><option value="">Everyone</option>{assigneeOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Sort tasks<select name="sort" defaultValue={sort}><option value="priority">Recommended priority</option><option value="due">Due date (earliest)</option><option value="recent">Recently updated</option></select></label>
      <label>ClickUp status<select name="status" defaultValue={filters.status ?? ''}><option value="">Any status</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>Activity<select name="age" defaultValue={filters.age ?? ''}><option value="">Any time</option><option value="recent">Recently active</option><option value="30">Stale active</option></select></label>
      <button type="submit">Show results</button><a href={`/clients/${slug}?view=${view}`}>Clear filters</a>
    </form>
    <p className="filter-results">{search ? "Searching every imported task in this client, including completed and unanalyzed work. " : ""}Sort: {sort === "due" ? "earliest due date first" : sort === "recent" ? "most recently updated first" : "overdue, urgent/high priority, then approaching due dates"}. Team member filters use ClickUp task assignments. AI recommendations remain unverified. {filtered.length} of {tasks.length} imported tasks match.{hasFilters ? " Section counts reflect the current filters." : ""} {analyzedCount} of {tasks.length} have AI assessments; action categories do not cover unanalyzed tasks.</p>
    <div className="detail-sections compact-intel-sections client-workspace-content">
      {view === 'ami' && <CompactTaskSection title="Needs Ami" eyebrow="FIRST PRIORITY" tasks={needsAmi} sectionId="needs-ami" {...sectionProps} />}
      {view === 'waiting' && <CompactTaskSection title="Waiting on someone" eyebrow="DEPENDENCIES" tasks={waiting} sectionId="waiting" {...sectionProps} />}
      {view === 'active' && <>
        <CompactTaskSection title="Recently active" eyebrow="IN PROGRESS" tasks={recentlyActive} sectionId="active" {...sectionProps} />
        <CompactTaskSection title="Stale active" tasks={stale} sectionId="stale" collapsed {...sectionProps} />
      </>}
      {view === 'overdue' && <>
        <CompactTaskSection title="Past due · updated within 30 days" eyebrow="RECENT ACTIVITY" tasks={overdueRecent} sectionId="overdue-recent" {...sectionProps} />
        <CompactTaskSection title="Past due · older or undated activity" eyebrow="HISTORICAL BACKLOG · VERIFY" tasks={overdueOlder} sectionId="overdue-older" {...sectionProps} />
      </>}
      {view === 'all' && <CompactTaskSection title={search ? 'Search results across all client tasks' : 'All matching tasks'} eyebrow="TASK DIRECTORY" tasks={allMatching} sectionId="all-tasks" {...sectionProps} emptyMessage="No client tasks match these filters. Try another search or clear filters." />}
    </div>
  </main>;
}
