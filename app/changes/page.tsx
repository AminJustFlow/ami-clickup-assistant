import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { markDigestChecked } from './actions';

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
  return <main className="ops-shell">
    <header className="ops-header"><div>
      <a href="/">← Ami Intelligence</a>
      <p className="eyebrow" style={{marginTop:16}}>ACTIVITY DIGEST</p>
      <h1>What changed since you last checked?</h1>
      <p className="muted">{hasCheckpoint ? 'Since ' + since.toLocaleString('en-US') : 'First visit: showing the last 7 days.'} This checkpoint is saved in this browser.</p>
    </div></header>
    <section className="attention-section">
      <div className="section-heading"><h2>Currently needs Ami</h2><span className="count-badge attention-count">{needsAmi.length}</span></div>
      <p className="muted">Current outstanding actions, not necessarily newly raised since your last visit.</p>
      {needsAmi.length === 0 && <p>Nothing currently requires Ami&apos;s attention.</p>}
      {needsAmi.map(t => <article className="compact-task" key={t.id}><div className="task-kicker">{t.client.name}</div><strong>{t.name}</strong><p>{t.intelligence?.amiAction ?? t.intelligence?.currentSummary}</p>{t.clickupUrl && <a href={t.clickupUrl} target="_blank" rel="noreferrer">ClickUp →</a>}</article>)}
    </section>
    <section className="ops-section">
      <div className="section-heading"><div><p className="eyebrow">RECORDED ACTIVITY</p><h2>{items.length} changes and comments</h2></div></div>
      <p className="muted">Status and field changes are observed between syncs; exact edit time and actor are unknown. Comments use their ClickUp timestamps. No intelligence-state transition history is stored yet.</p>
      <form action={markDigestChecked}><button className="digest-button" type="submit">Mark reviewed up to now</button></form>
      {grouped.map(group => <details key={group.key} className="digest-group" open={group.items.length > 0}>
        <summary>{group.label} ({group.items.length})</summary>
        {group.items.length === 0 && <p className="muted">No recorded activity in this category.</p>}
        {group.items.map(item => <article className="compact-task" key={item.key}>
          <div className="task-kicker">{item.client} · {item.date.toLocaleString('en-US')}</div>
          <strong>{item.title}</strong><p>{item.detail}</p>
          {item.url && <a href={item.url} target="_blank" rel="noreferrer">Open in ClickUp →</a>}
        </article>)}
      </details>)}
      {events.length === 250 || comments.length === 250 ? <p className="muted">Results capped at 250 events and 250 comments. Narrower pagination will be added for larger workloads.</p> : null}
    </section>
  </main>;
}
