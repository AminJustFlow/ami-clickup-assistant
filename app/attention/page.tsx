import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { groupClientFolders } from '@/lib/clients/grouping';
import { AppNav } from '../components/app-nav';
import { TaskDetailsButton } from '../components/task-details';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
type Filters = { client?: string; priority?: string; q?: string; page?: string };
type Priority = 'all' | 'overdue' | 'high' | 'recent';
const priorities: Priority[] = ['all', 'overdue', 'high', 'recent'];

function urlFor(filters: { client: string; priority: Priority; q: string }, page = 1) {
  const query = new URLSearchParams();
  if (filters.client) query.set('client', filters.client);
  if (filters.priority !== 'all') query.set('priority', filters.priority);
  if (filters.q) query.set('q', filters.q);
  if (page > 1) query.set('page', String(page));
  return '/attention' + (query.size ? '?' + query.toString() : '');
}

export default async function AttentionPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const params = await searchParams;
  const priority: Priority = priorities.includes(params.priority as Priority) ? params.priority as Priority : 'all';
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
  const groups = groupClientFolders(folders)
    .sort((a, b) => a.canonical.name.localeCompare(b.canonical.name));
  const selectedGroup = groups.find(group => group.canonical.slug === client);
  const activeFilters = { client: selectedGroup ? client : '', priority, q };

  const baseWhere = {
    deleted: false,
    client: { active: true, space: { name: 'JF Corporate' } },
    intelligence: { is: { needsAmi: true } }
  } as const;

  const where = {
    ...baseWhere,
    ...(selectedGroup ? { clientId: { in: selectedGroup.folders.map(folder => folder.id) } } : {}),
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { intelligence: { is: { needsAmi: true, amiAction: { contains: q, mode: 'insensitive' as const } } } }
    ] } : {}),
    ...(priority === 'overdue' ? { dueDate: { lt: now }, intelligence: { is: { needsAmi: true, agentState: { not: 'COMPLETED' as const } } } } : {}),
    ...(priority === 'high' ? { intelligence: { is: { needsAmi: true, amiAttentionScore: { gte: 70 } } } } : {}),
    ...(priority === 'recent' ? { clickupUpdatedAt: { gte: weekAgo } } : {})
  };

  const [total, allNeedsAmi, analyzedCount, importedCount] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.count({ where: baseWhere }),
    prisma.task.count({ where: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } }, intelligence: { isNot: null } } }),
    prisma.task.count({ where: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } } } })
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true, name: true, dueDate: true, clickupUpdatedAt: true, clickupUrl: true,
      client: { select: { name: true } },
      intelligence: { select: { amiAction: true, currentSummary: true, agentState: true, waitingOnName: true, amiAttentionScore: true, analyzedAt: true } }
    },
    orderBy: [
      { intelligence: { amiAttentionScore: 'desc' } },
      { clickupUpdatedAt: 'desc' },
      { id: 'asc' }
    ],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE
  });
  const dateLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  return <main className="ops-shell dashboard-shell" id="main-content">
    <AppNav current="attention" />
    <header className="detail-hero attention-hero">
      <p className="eyebrow">AMI'S ACTION INBOX</p>
      <h1>Decisions that need you</h1>
      <p>Prioritized requests from analyzed ClickUp tasks. Review the evidence and respond in ClickUp.</p>
    </header>
    <section className="detail-stat-strip" aria-label="Attention overview">
      <div><strong>{allNeedsAmi}</strong><span>Flagged for Ami</span></div>
      <div><strong>{total}</strong><span>Matching filters</span></div>
      <div><strong>{analyzedCount.toLocaleString()}</strong><span>Tasks analyzed</span></div>
      <div><strong>{importedCount ? Math.round(100 * analyzedCount / importedCount) : 0}%</strong><span>Analysis coverage</span></div>
    </section>
    <p className="dashboard-note attention-coverage">Only analyzed tasks can appear in this inbox. {Math.max(0, importedCount - analyzedCount).toLocaleString()} imported tasks are still awaiting analysis; zero flagged items does not necessarily mean all work is complete.</p>
    <section className="clean-panel attention-panel" aria-labelledby="inbox-title">
      <div className="panel-heading"><div><p className="eyebrow">ACTION QUEUE</p><h2 id="inbox-title">Needs Ami</h2><p>Highest attention score first. Filters update the queue without changing ClickUp.</p></div><span className="panel-count">{total}</span></div>
      <form className="attention-filters" method="get" action="/attention">
        <label>Client
          <select name="client" defaultValue={activeFilters.client}>
            <option value="">All clients</option>
            {groups.map(group => <option key={group.canonical.slug} value={group.canonical.slug}>{group.canonical.name}</option>)}
          </select>
        </label>
        <label>Show
          <select name="priority" defaultValue={priority}>
            <option value="all">All decisions</option>
            <option value="overdue">Past due date</option>
            <option value="high">Attention score 70+</option>
            <option value="recent">Updated in last 7 days</option>
          </select>
        </label>
        <label className="attention-search-label">Search task or action
          <input type="search" name="q" maxLength={120} defaultValue={q} placeholder="Task name or decision..." />
        </label>
        <button type="submit">Apply filters</button>
        <Link href="/attention">Clear</Link>
      </form>
      {tasks.length === 0 ? <div className="friendly-empty"><strong>No matching decisions</strong><p>Try clearing the filters. This inbox only includes tasks already analyzed by AI.</p></div> :
        <div className="clean-task-list">{tasks.map(task => {
          const intel = task.intelligence;
          const overdue = !!task.dueDate && task.dueDate < now && intel?.agentState !== 'COMPLETED';
          return <article className="clean-task attention-item" key={task.id}>
            <div className="task-topline"><span>{task.client.name}</span><span className="status-pill attention-pill">Needs Ami · score {intel?.amiAttentionScore ?? 0}</span></div>
            <p className="next-step-label">Decision / next action</p>
            <p className="ami-next-action">{intel?.amiAction || intel?.currentSummary || 'Review the task for next steps.'}</p>
            <h3 className="task-context-title">{task.name}</h3>
            <div className="attention-meta">
              {task.dueDate && <span className={overdue ? 'attention-overdue' : ''}>{overdue ? 'Past due' : 'Due'}: {dateLabel(task.dueDate)}</span>}
              {intel?.waitingOnName && <span>Waiting on: {intel.waitingOnName}</span>}
              {intel?.analyzedAt && <span>Analyzed: {dateLabel(intel.analyzedAt)}</span>}
            </div>
            <div className="task-card-actions"><TaskDetailsButton taskId={task.id} label="Review context" />{task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noopener noreferrer">Open in ClickUp ↗</a>}</div>
          </article>;
        })}</div>}
      <nav className="attention-pagination" aria-label="Inbox pages">
        <span>Page {currentPage} of {totalPages} · {total} matching</span>
        <div>{currentPage > 1 && <Link href={urlFor(activeFilters, currentPage - 1)}>← Previous</Link>}{currentPage < totalPages && <Link href={urlFor(activeFilters, currentPage + 1)}>Next →</Link>}</div>
      </nav>
    </section>
    <p className="dashboard-note">AI classifications are advisory. Review the latest ClickUp details before making decisions. This page does not modify ClickUp tasks.</p>
  </main>;
}
