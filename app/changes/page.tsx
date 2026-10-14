import { cookies } from 'next/headers';
import { isOpenAttentionTask } from '@/lib/attention/triage';
import { prisma } from '@/lib/db/prisma';
import { markDigestChecked } from './actions';
import { AppNav } from '../components/app-nav';

export const dynamic = 'force-dynamic';

type ChangeItem = { key: string; date: Date; title: string; detail: string; author?: string; client: string; url: string | null; category: 'status' | 'assignment' | 'admin' | 'comment' };
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
      author: c.authorName ?? 'Unknown author',
      detail: c.body.trim() || '(no text)'
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
  // Only collapse recognizable routine maintenance confirmations, never arbitrary comments.
  // Keep every original event available inside its expandable group.
  const routineMessage = /performed website maintenance today[,.]? everything is functioning as expected/i;
  const activityGroups: { item: ChangeItem; entries: ChangeItem[]; routine: boolean }[] = [];
  const routineGroups = new Map<string, (typeof activityGroups)[number]>();
  for (const item of filtered) {
    const routine = item.category === 'comment' && routineMessage.test(item.detail);
    const key = routine ? [item.client, item.title, item.detail.trim().toLowerCase()].join('|') : '';
    const existing = routine ? routineGroups.get(key) : undefined;
    if (existing) existing.entries.push(item);
    else {
      const group = { item, entries: [item], routine };
      activityGroups.push(group);
      if (routine) routineGroups.set(key, group);
    }
  }
  const pageNumber = Math.max(1, Math.min(100, Number.isInteger(Number(filters.page)) ? Number(filters.page) : 1));
  const perPage = 12;
  const maxPage = Math.max(1, Math.ceil(activityGroups.length / perPage));
  const currentPage = Math.min(pageNumber, maxPage);
  const shown = activityGroups.slice((currentPage - 1) * perPage, currentPage * perPage);
  const query = new URLSearchParams();
  for (const key of ['client', 'category', 'range', 'q'] as const) if (filters[key]) query.set(key, filters[key]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return '?' + params.toString() + '#activity-timeline';
  };
  const tabHref = (category: string) => {
    const params = new URLSearchParams(query);
    if (category) params.set('category', category);
    else params.delete('category');
    params.delete('page');
    const qs = params.toString();
    return '/changes' + (qs ? '?' + qs : '') + '#activity-timeline';
  };
  const tabEligible = items.filter(item =>
    (!filters.client || item.client === filters.client) &&
    (!search || [item.title, item.client, item.detail].some(value => value.toLowerCase().includes(search)))
  );
  const tabCounts = {
    all: tabEligible.length,
    comment: tabEligible.filter(item => item.category === 'comment').length,
    status: tabEligible.filter(item => item.category === 'status').length,
    assignment: tabEligible.filter(item => item.category === 'assignment').length
  };
  const categoryLabel: Record<ChangeItem['category'], string> = {
    status: 'Status', comment: 'Comment', assignment: 'Assignment', admin: 'Update'
  };
  return <main id="main-content" className="ops-shell dashboard-shell recent-updates-workspace">
    <AppNav current="activity" />
    <header className="detail-hero">
      <p className="eyebrow">CLICKUP ACTIVITY</p><h1>Recent updates</h1>
      <p>A clear view of what changed across your clients. Showing activity since {since.toLocaleString('en-US')}.</p>
    </header>
    <div className="detail-stat-strip activity-stats">
      <div><strong>{items.length}</strong><span>Recorded updates</span></div>
      <div><strong>{items.filter(i => i.category === 'comment').length}</strong><span>New comments</span></div>
      <div><strong>{items.filter(i => i.category === 'status').length}</strong><span>Status changes</span></div>
      <a className="activity-decision-stat" href="/attention"><strong>{openDecisions.length}</strong><span>Needs Ami's decision ↗</span></a>
    </div>
    <section className="clean-panel compact-activity-panel" id="activity-timeline">
      <div className="panel-heading activity-heading"><div><p className="eyebrow">ACTIVITY FEED</p><h2>All changes</h2>
        <p>Newest first · Routine maintenance confirmations are grouped when repeated.</p></div>
        <form action={markDigestChecked}><button className="digest-button" type="submit">Mark as read</button></form>
      </div>
      <nav className="activity-tabs" aria-label="Filter activity type">
        <a href={tabHref('')} aria-current={!filters.category ? 'page' : undefined}>All activity <span>{tabCounts.all}</span></a>
        <a href={tabHref('comment')} aria-current={filters.category === 'comment' ? 'page' : undefined}>Comments <span>{tabCounts.comment}</span></a>
        <a href={tabHref('status')} aria-current={filters.category === 'status' ? 'page' : undefined}>Status <span>{tabCounts.status}</span></a>
        <a href={tabHref('assignment')} aria-current={filters.category === 'assignment' ? 'page' : undefined}>Assignments <span>{tabCounts.assignment}</span></a>
      </nav>
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
      <p className="compact-activity-count" role="status">{filtered.length} matching updates · {activityGroups.length} feed entries{activityGroups.length !== filtered.length ? ' (repeated maintenance grouped)' : ''} · Page {currentPage} of {maxPage}</p>
      <div className="activity-feed-list" aria-label="Recent ClickUp activity">{shown.map(group => {
        const item = group.item;
        const grouped = group.entries.length > 1;
        return <article className="activity-feed-item" key={item.key}>
          <div className={`activity-feed-icon activity-feed-${item.category}`} aria-hidden="true">{item.category === 'comment' ? '✎' : item.category === 'status' ? '↻' : item.category === 'assignment' ? '◎' : '•'}</div>
          <div className="activity-feed-content">
            <div className="activity-feed-meta"><span className="activity-feed-client">{item.client}</span><span className="activity-feed-time">{item.date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span className={`activity-feed-tag activity-feed-tag-${item.category}`}>{group.routine ? 'Routine' : categoryLabel[item.category]}</span></div>
            <h3>{item.title}</h3>
            {item.category === 'comment' && <p className="recent-update-author">Comment by <strong>{item.author}</strong></p>}
            {item.category === 'comment' && item.detail.length > 220 ? <details className="recent-update-expand"><summary>{item.detail.slice(0, 220)}… <span>Read full comment</span></summary><p>{item.detail}</p></details> : <p className="activity-feed-detail">{item.detail}</p>}
            {grouped && <details className="activity-feed-group"><summary>{group.entries.length} similar maintenance updates · View all</summary>
              <ul>{group.entries.map(entry => <li key={entry.key}><span>{entry.date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">View in ClickUp ↗</a>}</li>)}</ul>
            </details>}
          </div>
          {item.url && <a className="activity-feed-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} in ClickUp`}>View in ClickUp ↗</a>}
        </article>;
      })}
      {shown.length === 0 && <p className="simple-empty">No updates match these filters. Try a longer period or clear the filters.</p>}</div>
      <nav className="compact-activity-pagination" aria-label="Activity pages">
        {currentPage > 1 ? <a href={pageHref(currentPage - 1)}>← Previous</a> : <span />}
        {currentPage < maxPage && <a href={pageHref(currentPage + 1)}>Next 12 →</a>}
      </nav>
    </section>
    <p className="dashboard-note">Field changes are detected between ClickUp syncs, so exact edit times and authors may be unknown. Comments retain their ClickUp timestamps. Mark as read stores a browser checkpoint; use “Since last read” to view that period.</p>
    {(events.length === 250 || comments.length === 250) && <p className="dashboard-note">The timeline retrieves at most 250 field events and 250 comments before applying filters. Counts are limited to that sample.</p>}
  </main>;
}
