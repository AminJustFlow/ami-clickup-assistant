import { cookies } from 'next/headers';
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

export default async function ChangesPage() {
  const jar = await cookies();
  const raw = jar.get('ami_intelligence_last_checked')?.value;
  const parsed = raw ? new Date(raw) : null;
  const hasCheckpoint = !!parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
  const since = hasCheckpoint ? parsed! : new Date(Date.now() - 7 * 86400000);
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
      where: { deleted: false, intelligence: { needsAmi: true } },
      include: { client: true, intelligence: true },
      orderBy: { intelligence: { amiAttentionScore: 'desc' } }, take: 30
    })
  ]);
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
  items.sort((a,b) => b.date.getTime() - a.date.getTime());
  const grouped = categories.map(category => ({ ...category, items: items.filter(item => item.category === category.key) }));
  const recent = items.slice(0, 25);
  const remaining = items.slice(25);
  return <main className="ops-shell dashboard-shell">
    <AppNav current="activity" />
    <header className="detail-hero">
      <p className="eyebrow">ACTIVITY</p><h1>What's changed?</h1>
      <p>{hasCheckpoint ? 'Since your last check on ' + since.toLocaleString('en-US') : 'Showing activity from the last 7 days.'}</p>
    </header>
    <div className="detail-stat-strip activity-stats">
      <div><strong>{items.length}</strong><span>Updates</span></div>
      <div><strong>{grouped.find(g=>g.key==='comment')?.items.length ?? 0}</strong><span>New comments</span></div>
      <div><strong>{grouped.find(g=>g.key==='status')?.items.length ?? 0}</strong><span>Status changes</span></div>
      <div><strong>{needsAmi.length}</strong><span>Need Ami now</span></div>
    </div>
    <div className="detail-sections">
      {needsAmi.length > 0 && <section className="clean-panel"><div className="panel-heading"><div><p className="eyebrow">CURRENT PRIORITIES</p><h2>Still needs your attention</h2><p>These items are open now, not necessarily new changes.</p></div><span className="panel-count">{needsAmi.length}</span></div><div className="clean-task-list">{needsAmi.map(task=><article className="clean-task" key={task.id}><div className="task-topline"><span>{task.client.name}</span><span className="status-pill attention-pill">Action needed</span></div><h3>{task.name}</h3><p>{task.intelligence?.amiAction || task.intelligence?.currentSummary}</p>{task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noreferrer">Open task ↗</a>}</article>)}</div></section>}
      <section className="clean-panel">
        <div className="panel-heading activity-heading"><div><p className="eyebrow">TIMELINE</p><h2>Recent updates</h2><p>Latest comments and changes across your clients.</p></div>
          <form action={markDigestChecked}><button className="digest-button" type="submit">Mark as read</button></form>
        </div>
        <div className="activity-list">{recent.length ? recent.map(item=><article className="activity-item" key={item.key}><span className={`activity-dot activity-${item.category}`} aria-hidden="true"/><div><div className="task-topline"><span>{item.client} · {item.date.toLocaleString('en-US')}</span><span className="status-pill">{item.category === 'comment' ? 'Comment' : item.category === 'status' ? 'Status' : item.category === 'assignment' ? 'Assignment' : 'Update'}</span></div><h3>{item.title}</h3><p>{item.detail}</p>{item.url && <a className="task-action" href={item.url} target="_blank" rel="noreferrer">View in ClickUp ↗</a>}</div></article>) : <p className="simple-empty">No changes recorded in this period.</p>}</div>
        {remaining.length > 0 && <details className="activity-more"><summary>Show {remaining.length} older updates</summary><div className="activity-list">{remaining.map(item=><article className="activity-item" key={item.key}><span className={`activity-dot activity-${item.category}`} aria-hidden="true"/><div><div className="task-topline"><span>{item.client} · {item.date.toLocaleString('en-US')}</span><span className="status-pill">{item.category}</span></div><h3>{item.title}</h3><p>{item.detail}</p>{item.url && <a className="task-action" href={item.url} target="_blank" rel="noreferrer">View in ClickUp ↗</a>}</div></article>)}</div></details>}
      </section>
      <p className="dashboard-note">Field changes are detected between ClickUp syncs, so their exact edit time and author may be unknown. Comments retain their ClickUp timestamps. AI interpretations are not shown as ClickUp activity. The read checkpoint is stored in this browser.</p>
      {(events.length === 250 || comments.length === 250) && <p className="dashboard-note">Activity is capped at 250 field events and 250 comments per view.</p>}
    </div>
  </main>;
}
