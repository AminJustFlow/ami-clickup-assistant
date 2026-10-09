import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { groupClientFolders } from '@/lib/clients/grouping';
import { AppNav } from '../components/app-nav';
import { TaskDetailsButton } from '../components/task-details';
import { setAttentionDecision } from './actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;
type Priority = 'all' | 'overdue' | 'high' | 'recent';
type View = 'active' | 'history';
type Filters = { client?: string; priority?: string; q?: string; page?: string; view?: string; notice?: string };
const priorities: Priority[] = ['all', 'overdue', 'high', 'recent'];
const isClosed = (status: string | null) => /^(done|complete|completed|closed|cancelled|canceled)$/i.test(status?.trim() ?? '');
const fingerprint = (intel: { sourceFingerprint: string | null; analyzedAt: Date | null }) =>
  intel.sourceFingerprint ?? `analyzed:${intel.analyzedAt?.toISOString() ?? 'unknown'}`;
const dateLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function urlFor(filters: { client: string; priority: Priority; q: string; view: View }, page = 1) {
  const query = new URLSearchParams();
  if (filters.client) query.set('client', filters.client);
  if (filters.priority !== 'all') query.set('priority', filters.priority);
  if (filters.q) query.set('q', filters.q);
  if (filters.view !== 'active') query.set('view', filters.view);
  if (page > 1) query.set('page', String(page));
  return '/attention' + (query.size ? '?' + query.toString() : '');
}

export default async function AttentionPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const params = await searchParams;
  const priority: Priority = priorities.includes(params.priority as Priority) ? params.priority as Priority : 'all';
  const view: View = params.view === 'history' ? 'history' : 'active';
  const q = (params.q ?? '').trim().slice(0, 120);
  const client = (params.client ?? '').slice(0, 150);
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const folders = await prisma.client.findMany({
    where: { active: true, space: { name: 'JF Corporate' } },
    select: { id: true, name: true, slug: true, clickupFolderId: true }
  });
  const groups = groupClientFolders(folders).sort((a, b) => a.canonical.name.localeCompare(b.canonical.name));
  const selectedGroup = groups.find(group => group.canonical.slug === client);
  const activeFilters = { client: selectedGroup ? client : '', priority, q, view };

  const scope = { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } as const;
  const [candidates, analyzedCount, importedCount] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...scope,
        intelligence: { is: { needsAmi: true } },
        ...(selectedGroup ? { clientId: { in: selectedGroup.folders.map(folder => folder.id) } } : {}),
        ...(q ? { OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { intelligence: { is: { needsAmi: true, amiAction: { contains: q, mode: 'insensitive' as const } } } }
        ] } : {}),
        ...(priority === 'recent' ? { clickupUpdatedAt: { gte: weekAgo } } : {}),
        ...(priority === 'high' ? { intelligence: { is: { needsAmi: true, amiAttentionScore: { gte: 70 } } } } : {}),
        ...(priority === 'overdue' ? { dueDate: { lt: now } } : {})
      },
      select: {
        id: true, name: true, dueDate: true, clickupUpdatedAt: true, clickupUrl: true, clickupStatus: true,
        client: { select: { name: true } },
        attentionDisposition: { select: { decision: true, sourceFingerprint: true, updatedAt: true } },
        intelligence: { select: {
          amiAction: true, currentSummary: true, agentState: true, waitingOnName: true,
          amiAttentionScore: true, analyzedAt: true, sourceFingerprint: true
        } }
      },
      orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }, { id: 'asc' }]
    }),
    prisma.task.count({ where: { ...scope, intelligence: { isNot: null } } }),
    prisma.task.count({ where: scope })
  ]);

  const categorized = candidates.map(task => {
    const intel = task.intelligence!;
    const closed = intel.agentState === 'COMPLETED' || isClosed(task.clickupStatus);
    const recorded = task.attentionDisposition?.sourceFingerprint === fingerprint(intel)
      ? task.attentionDisposition.decision : null;
    const overdue = !closed && !!task.dueDate && task.dueDate < now;
    const urgency = overdue ? 'Overdue' : intel.amiAttentionScore >= 70 ? 'High priority' : 'Normal';
    return { ...task, closed, recorded, overdue, urgency };
  });
  const active = categorized.filter(task => !task.closed && !task.recorded);
  const history = categorized.filter(task => task.closed || !!task.recorded);
  const selected = (view === 'active' ? active : history)
    .filter(task => priority !== 'overdue' || task.overdue)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue)
      || (b.intelligence?.amiAttentionScore ?? 0) - (a.intelligence?.amiAttentionScore ?? 0)
      || (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0) || a.id - b.id);
  const total = selected.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const tasks = selected.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const highCount = active.filter(task => task.urgency === 'High priority' || task.overdue).length;
  const overdueCount = active.filter(task => task.overdue).length;
  const returnTo = urlFor(activeFilters, currentPage);

  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="attention" />
    <header className="detail-hero attention-hero">
      <p className="eyebrow">AMI'S ACTION INBOX</p>
      <h1>Decisions that need you</h1>
      <p>Focus on the next decision. Open context when needed, and track your review without changing ClickUp.</p>
    </header>
    <section className="detail-stat-strip" aria-label="Attention overview">
      <div><strong>{active.length}</strong><span>Open decisions in current scope</span></div>
      <div><strong>{overdueCount}</strong><span>Past due</span></div>
      <div><strong>{highCount}</strong><span>High priority or overdue</span></div>
      <div><strong>{importedCount ? Math.round(100 * analyzedCount / importedCount) : 0}%</strong><span>AI analysis coverage</span></div>
    </section>
    <p className="dashboard-note attention-coverage">{analyzedCount.toLocaleString()} of {importedCount.toLocaleString()} imported tasks analyzed across active clients. Unanalyzed tasks cannot appear here. Human reviews are stored only in this app.</p>
    {params.notice === 'stale' && <p className="attention-notice" role="status">This task's AI assessment changed. Review its latest context before updating it.</p>}
    <section className="clean-panel attention-panel" aria-labelledby="inbox-title">
      <div className="panel-heading">
        <div><p className="eyebrow">ACTION QUEUE</p><h2 id="inbox-title">{view === 'active' ? 'Needs Ami' : 'Reviewed & archived'}</h2><p>{view === 'active' ? 'Open decisions, with past-due items first.' : 'Completed tasks and decisions you have reviewed or dismissed.'}</p></div>
        <span className="panel-count">{total}</span>
      </div>
      <nav className="attention-view-tabs" aria-label="Inbox view">
        <Link aria-current={view === 'active' ? 'page' : undefined} href={urlFor({ ...activeFilters, view: 'active' })}>Open decisions ({active.length})</Link>
        <Link aria-current={view === 'history' ? 'page' : undefined} href={urlFor({ ...activeFilters, view: 'history' })}>Reviewed & archived ({history.length})</Link>
      </nav>
      <form className="attention-filters" method="get" action="/attention">
        <input type="hidden" name="view" value={view} />
        <label>Client
          <select name="client" defaultValue={activeFilters.client}>
            <option value="">All clients</option>
            {groups.map(group => <option key={group.canonical.slug} value={group.canonical.slug}>{group.canonical.name}</option>)}
          </select>
        </label>
        <label>Priority
          <select name="priority" defaultValue={priority}>
            <option value="all">All priorities</option>
            <option value="overdue">Past due date</option>
            <option value="high">Attention score 70+</option>
            <option value="recent">Updated in last 7 days</option>
          </select>
        </label>
        <label className="attention-search-label">Search
          <input type="search" name="q" maxLength={120} defaultValue={q} placeholder="Task or decision..." />
        </label>
        <button type="submit">Apply filters</button>
        <Link href="/attention">Clear</Link>
      </form>
      {tasks.length === 0 ? <div className="friendly-empty"><strong>No matching {view === 'active' ? 'open decisions' : 'archived decisions'}</strong><p>Try clearing your filters. New AI analyses may add more items.</p></div> :
        <div className="attention-rows">{tasks.map(task => {
          const intel = task.intelligence!;
          return <article className="attention-row" key={task.id}>
            <div className="attention-row-main">
              <div className="attention-row-byline"><span>{task.client.name}</span><span className={task.overdue ? 'attention-urgency overdue' : intel.amiAttentionScore >= 70 ? 'attention-urgency high' : 'attention-urgency normal'}>{task.closed ? 'Completed in ClickUp / AI' : task.recorded ? (task.recorded === 'REVIEWED' ? 'Reviewed' : 'Dismissed') : task.urgency}</span></div>
              <h3>{task.name}</h3>
              <p className="attention-row-action">{intel.amiAction || intel.currentSummary || 'Review the task for next steps.'}</p>
              <div className="attention-meta">
                {task.dueDate && <span className={task.overdue ? 'attention-overdue' : ''}>{task.overdue ? 'Past due' : 'Due'}: {dateLabel(task.dueDate)}</span>}
                {intel.waitingOnName && <span>Waiting on: {intel.waitingOnName}</span>}
                {intel.analyzedAt && <span>Analyzed: {dateLabel(intel.analyzedAt)}</span>}
              </div>
            </div>
            <div className="attention-row-actions">
              <TaskDetailsButton taskId={task.id} label="Review context" />
              {task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
              {view === 'history' && task.recorded && !task.closed && <form action={setAttentionDecision} className="attention-decision-form">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="fingerprint" value={fingerprint(intel)} />
                <input type="hidden" name="returnTo" value="/attention" />
                <button type="submit" name="decision" value="REOPEN">Reopen decision</button>
              </form>}
              {view === 'active' && <form action={setAttentionDecision} className="attention-decision-form">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="fingerprint" value={fingerprint(intel)} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" name="decision" value="REVIEWED" title="Remove from open inbox; no changes to ClickUp">Mark reviewed</button>
                <button type="submit" name="decision" value="DISMISSED" className="attention-dismiss" title="Dismiss this AI recommendation; no changes to ClickUp">Dismiss</button>
              </form>}
            </div>
          </article>;
        })}</div>}
      <nav className="attention-pagination" aria-label="Inbox pages">
        <span>Page {currentPage} of {totalPages} · {total} matching</span>
        <div>{currentPage > 1 && <Link href={urlFor(activeFilters, currentPage - 1)}>← Previous</Link>}{currentPage < totalPages && <Link href={urlFor(activeFilters, currentPage + 1)}>Next →</Link>}</div>
      </nav>
    </section>
    <p className="dashboard-note">Reviewing or dismissing an AI recommendation does not close, update, or acknowledge a ClickUp task. New AI assessments may bring a previously reviewed task back into the open inbox.</p>
  </main>;
}
