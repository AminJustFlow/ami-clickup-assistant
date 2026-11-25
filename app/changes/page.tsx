import { groupConversationUpdates } from '@/lib/intelligence/conversation';
import { changedSinceAnalysis, isClosedClickUpStatus } from '@/lib/attention/triage';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from '../components/app-nav';
import { TaskDetailsButton } from '../components/task-details';

export const dynamic = 'force-dynamic';

type Filters = { client?: string; kind?: string; range?: string };
const dateTime = (date: Date | null) => date ? date.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase());

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const days = filters.range === '30' ? 30 : filters.range === '1' ? 1 : 7;
  const since = new Date(Date.now() - days * 86_400_000);
  const [clients, updates] = await Promise.all([
    prisma.client.findMany({ where: { active: true }, select: { slug: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.operationalUpdate.findMany({
      where: {
        verified: true,
        OR: [{ evidenceAt: { gte: since } }, { evidenceAt: null, createdAt: { gte: since } }],
        task: { deleted: false, ...(filters.client ? { client: { slug: filters.client } } : {}) },
        ...(filters.kind ? { kind: filters.kind } : {})
      },
      include: { task: { select: { id: true, name: true, clickupUrl: true, clientId: true, clickupStatus: true, clickupUpdatedAt: true,
        comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } },
        intelligence: { select: { analyzedAt: true, verificationStatus: true, freshnessStatus: true, needsAmi: true, nextActor: true, amiAction: true } },
        client: { select: { name: true, slug: true } } } } },
      orderBy: [{ evidenceAt: 'desc' }, { createdAt: 'desc' }], take: 250
    })
  ]);
  const groups = groupConversationUpdates(updates);
  function approvalStatus(task: typeof updates[number]['task']) {
    if (isClosedClickUpStatus(task.clickupStatus)) return 'Closed in ClickUp';
    const intel = task.intelligence;
    if (!intel?.analyzedAt || intel.verificationStatus !== 'VERIFIED' || intel.freshnessStatus !== 'CURRENT' || changedSinceAnalysis(task, intel.analyzedAt)) return 'Current approval status unconfirmed';
    if (intel.needsAmi && intel.nextActor === 'AMI') return intel.amiAction || "Awaiting Ami's decision";
    return 'No current decision for Ami';
  }
  const kinds = ['DECISION_REQUESTED', 'DECISION_RESOLVED', 'BLOCKED', 'UNBLOCKED', 'DEADLINE_CHANGED', 'OWNERSHIP_CHANGED', 'STATUS_CHANGED', 'DEPENDENCY_CHANGED', 'PROGRESS', 'COMPLETED', 'REOPENED'];
  return <main className="ops-shell dashboard-shell" id="main-content"><AppNav current="activity" />
    <header className="detail-hero"><p className="eyebrow">MEANINGFUL DEVELOPMENTS</p><h1>What changed</h1><p>Operational changes that alter a decision, blocker, handoff, or outcome. Routine ClickUp notification noise is excluded.</p></header>
    <form className="filter-bar clean-filters" method="GET">
      <label>Client<select name="client" defaultValue={filters.client ?? ''}><option value="">All clients</option>{clients.map(client => <option value={client.slug} key={client.slug}>{client.name}</option>)}</select></label>
      <label>Change type<select name="kind" defaultValue={filters.kind ?? ''}><option value="">All meaningful changes</option>{kinds.map(kind => <option value={kind} key={kind}>{label(kind)}</option>)}</select></label>
      <label>Time window<select name="range" defaultValue={String(days)}><option value="1">Last day</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
      <button type="submit">Apply</button><a href="/changes">Clear</a>
    </form>
    <section className="clean-panel"><div className="panel-heading"><div><h2>{groups.length} verified development{groups.length === 1 ? '' : 's'}</h2><p>Newest evidence first.</p></div></div>
      {updates.length ? <div className="brief-task-list">{groups.map(({ citation, items }) => {
        const update = items[0];
        if (citation && items.length > 1) return <section key={update.id} className="brief-task-main conversation-group">
          <div className="brief-task-meta"><span>{update.task.client.name}</span><span className="brief-tag">{label(update.kind)}</span><span>{dateTime(new Date(citation.at))}</span></div>
          <h3>One update across {items.length} deliverables</h3>
          <p>{citation.author && <strong>{citation.author}: </strong>}{citation.excerpt}</p>
          {items.map(member => <article className="brief-task-row" key={member.id}><div className="brief-task-main">
            <h4>{member.task.name}</h4><p>{approvalStatus(member.task)}</p>
          </div><div className="brief-task-actions"><TaskDetailsButton taskId={member.taskId} label="Context" />{member.task.clickupUrl && <a href={member.task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}</div></article>)}
        </section>;
        return <article className="brief-task-row" key={update.id}><div className="brief-task-main"><div className="brief-task-meta"><span>{update.task.client.name}</span><span className="brief-tag">{label(update.kind)}</span><span>{dateTime(update.evidenceAt ?? update.createdAt)}</span></div><h3>{update.task.name}</h3><p>{update.summary}</p>{update.impact && update.impact !== update.summary && <small>{update.impact}</small>}</div><div className="brief-task-actions"><TaskDetailsButton taskId={update.taskId} label="Context" />{update.task.clickupUrl && <a href={update.task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}</div></article>; })}</div> : <div className="brief-empty"><strong>No verified developments in this window</strong><p>This is not a raw activity log. New items appear only after evidence-backed analysis identifies a material operational change.</p></div>}
    </section>
  </main>;
}
