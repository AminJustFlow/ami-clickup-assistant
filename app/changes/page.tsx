import { cookies } from 'next/headers';
import { isOpenAttentionTask } from '@/lib/attention/triage';
import { prisma } from '@/lib/db/prisma';
import { markDigestChecked } from './actions';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

type ChangeItem = { key: string; date: Date; title: string; detail: string; client: string; url: string | null; category: 'status' | 'assignment' | 'admin' | 'comment' };
const categories = [
  { key: 'status', label: 'Status transitions' },
  { key: 'comment', label: 'New comments' },
  { key: 'assignment', label: 'Assignment changes' },
  { key: 'admin', label: 'Other task changes' }
] as const;

function eventValue(value: unknown): string {
  if (!value || typeof value !== 'object' || !('value' in value)) return 'not set';
  const v = (value as { value: unknown }).value;
  if (Array.isArray(v)) return v.join(', ') || 'none';
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return 'changed';
}

type ActivityFilters = { client?: string; category?: string; range?: string; q?: string; page?: string };

export default async function ChangesPage({ searchParams }: { searchParams: Promise<ActivityFilters> }) {
  const filters = await searchParams;
  const jar = await cookies();
  const raw = jar.get('ami_intelligence_last_checked')?.value;
  const parsed = raw ? new Date(raw) : null;
  const hasCheckpoint = !!parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
  const days = filters.range === '1' ? 1 : filters.range === '30' ? 30 : 7;
  const since = filters.range === 'checkpoint' && hasCheckpoint ? parsed! : new Date(Date.now() - days * 86400000);
  const [events, comments, needsAmi] = await Promise.all([
    prisma.taskEvent.findMany({
      where: { occurredAt: { gt: since }, task: { deleted: false } },
      include: { task: { include: { client: true } } },
      orderBy: { occurredAt: 'desc' }, take: 250
    }),
    prisma.comment.findMany({
      where: { clickupCreatedAt: { gt: since }, task: { deleted: false } },
      include: { task: { include: { client: true } } },
      orderBy: { clickupCreatedAt: 'desc' }, take: 250
    }),
    prisma.task.findMany({
      where: { deleted: false, client: { active: true, space: { name: 'JF Corporate' } }, intelligence: { needsAmi: true } },
      include: { client: true, intelligence: true, attentionDisposition: true },
      orderBy: { intelligence: { amiAttentionScore: 'desc' } }
    })
  ]);
  const openDecisions = needsAmi.filter(isOpenAttentionTask);
  const items: ChangeItem[] = [];
  for (const e of events) {
    if (!e.task || !e.occurredAt) continue;
    const category: ChangeItem['category'] = e.eventType.includes('STATUS') ? 'status'
      : e.eventType.includes('ASSIGNEES') ? 'assignment' : 'admin';
    items.push({
      key: 'event-' + e.id, date: e.occurredAt, category,
      title: e.task.name, client: e.task.client.name, url: e.task.clickupUrl,
      detail: e.eventType.replace(/^OBSERVED_/, '').replace(/_/g, ' ').toLowerCase()
        + ': ' + eventValue(e.beforeValue) + ' → ' + eventValue(e.afterValue)
    });
  }
  for (const c of comments) {
    if (!c.clickupCreatedAt) continue;
    items.push({
      key: 'comment-' + c.id, date: c.clickupCreatedAt, category: 'comment',
      title: c.task.name, client: c.task.client.name, url: c.task.clickupUrl,
      detail: (c.authorName ?? 'Someone') + ': ' + (c.body.trim().slice(0, 240) || '(no text)')
    });
  }
  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  const clients = [...new Set(items.map(item => item.client))].sort();
  const search = (filters.q ?? '').trim().toLowerCase();
  const filtered = items.filter(item =>
    (!filters.client || item.client === filters.client) &&
    (!filters.category || item.category === filters.category) &&
    (!search || [item.title, item.client, item.detail].some(s => s.toLowerCase().includes(search)))
  );
  const pageNumber = Math.max(1, Math.min(100, Number.isInteger(Number(filters.page)) ? Number(filters.page) : 1));
  const perPage = 20;
  const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(pageNumber, maxPage);
  const shown = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const query = new URLSearchParams();
  for (const key of ['client', 'category', 'range', 'q'] as const) if (filters[key]) query.set(key, filters[key]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return '?' + params.toString() + '#activity-timeline';
  };
  const categoryLabel: Record<ChangeItem['category'], string> = {
    status: 'Status', comment: 'Comment', assignment: 'Assignment', admin: 'Update'
  };
  return <main id="main-content" className="ops-shell dashboard-shell">
    <AppNav current="activity" />
    <header className="detail-hero">
      <p className="eyebrow">ACTIVITY</p><h1>What's changed?</h1>
      <p>Showing recorded ClickUp changes since {since.toLocaleString('en-US')}.</p>
    </header>
    <div className="detail-stat-strip activity-stats">
      <div><strong>{items.length}</strong><span>Recorded updates</span></div>
      <div><strong>{items.filter(i => i.category === 'comment').length}</strong><span>New comments</span></div>
      <div><strong>{items.filter(i => i.category === 'status').length}</strong><span>Status changes</span></div>
      <div><strong>{openDecisions.length}</strong><span>Open decisions for Ami</span></div>
    </div>
    <section className="clean-panel compact-activity-priority">
      <div className="panel-heading"><div><p className="eyebrow">CURRENT PRIORITIES</p><h2>Decisions still needing attention</h2>
        <p>Open decisions are tracked separately from the activity timeline.</p></div>
        <a className="task-action" href="/attention">Open action inbox →</a></div>
      <div className="compact-intel-list">{openDecisions.slice(0, 4).map(task => <article key={task.id} className="compact-activity-decision">
        <span>{task.client.name}</span><strong>{task.name}</strong><p>{task.intelligence?.amiAction || task.intelligence?.currentSummary}</p>
        {task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
      </article>)}
      {needsAmi.length === 0 && <p className="simple-empty">No open decisions at the moment.</p>}</div>
    </section>
    <section className="clean-panel compact-activity-panel" id="activity-timeline">
      <div className="panel-heading activity-heading"><div><p className="eyebrow">TIMELINE</p><h2>Recent updates</h2>
        <p>Filter by client, type, or time period.</p></div>
        <form action={markDigestChecked}><button className="digest-button" type="submit">Mark as read</button></form>
      </div>
      <form className="filter-bar clean-filters compact-activity-filters" method="GET">
        <label>Period<select name="range" defaultValue={filters.range ?? '7'}>
          <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
          {hasCheckpoint && <option value="checkpoint">Since last read</option>}
        </select></label>
        <label>Client<select name="client" defaultValue={filters.client ?? ''}><option value="">All clients</option>
          {clients.map(client => <option key={client} value={client}>{client}</option>)}</select></label>
        <label>Update type<select name="category" defaultValue={filters.category ?? ''}><option value="">All types</option>
          {categories.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
        <label className="search-label">Search<input type="search" name="q" defaultValue={filters.q ?? ''} placeholder="Task or update…" /></label>
        <button type="submit">Apply filters</button><a href="/changes">Clear</a>
      </form>
      <p className="compact-activity-count">{filtered.length} matching updates · Page {currentPage} of {maxPage}</p>
      <div className="compact-activity-list">{shown.map(item => <article className="compact-activity-row" key={item.key}>
        <span className={`activity-dot activity-${item.category}`} aria-hidden="true" />
        <div className="compact-activity-copy">
          <div className="compact-intel-meta"><span>{item.client}</span><span>{item.date.toLocaleString('en-US')}</span>
            <span className="status-pill">{categoryLabel[item.category]}</span></div>
          <h3>{item.title}</h3><p>{item.detail}</p>
        </div>
        {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
      </article>)}
      {shown.length === 0 && <p className="simple-empty">No updates match these filters.</p>}</div>
      <nav className="compact-activity-pagination" aria-label="Activity pages">
        {currentPage > 1 ? <a href={pageHref(currentPage - 1)}>← Previous</a> : <span />}
        {currentPage < maxPage && <a href={pageHref(currentPage + 1)}>Next 20 →</a>}
      </nav>
    </section>
    <p className="dashboard-note">Field changes are detected between ClickUp syncs, so exact edit times and authors may be unknown. Comments retain their ClickUp timestamps. Mark as read stores a browser checkpoint; use “Since last read” to view that period.</p>
    {(events.length === 250 || comments.length === 250) && <p className="dashboard-note">The timeline retrieves at most 250 field events and 250 comments before applying filters. Counts are limited to that sample.</p>}
  </main>;
}
