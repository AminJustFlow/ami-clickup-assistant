import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { groupClientFolders } from '@/lib/clients/grouping';
import { AppNav } from '../components/app-nav';
import { TaskDetailsButton } from '../components/task-details';
import { setAttentionDecision } from './actions';
import { dailyBrief } from '@/lib/attention/daily-brief';
import { attentionFingerprint, attentionVerificationReasons, isClosedClickUpStatus, isOpenAttentionTask } from '@/lib/attention/triage';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 12;
type Priority = 'all' | 'overdue' | 'high' | 'recent' | 'verify';
type View = 'active' | 'history';
type Filters = { client?: string; priority?: string; q?: string; page?: string; view?: string; notice?: string };
const priorities: Priority[] = ['all', 'overdue', 'high', 'recent', 'verify'];
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
        attentionDisposition: { select: { decision: true, reason: true, sourceFingerprint: true, updatedAt: true } },
        intelligence: { select: {
          amiAction: true, currentSummary: true, agentState: true, waitingOnName: true,
          needsAmi: true, amiAttentionScore: true, analyzedAt: true, sourceFingerprint: true, confidence: true
        } }
      },
      orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }, { id: 'asc' }]
    }),
    prisma.task.count({ where: { ...scope, intelligence: { isNot: null } } }),
    prisma.task.count({ where: scope })
  ]);

  const categorized = candidates.map(task => {
    const intel = task.intelligence!;
    const closed = intel.agentState === 'COMPLETED' || isClosedClickUpStatus(task.clickupStatus);
    const recorded = task.attentionDisposition && task.attentionDisposition.sourceFingerprint === attentionFingerprint(intel)
      ? task.attentionDisposition.decision : null;
    const overdue = !closed && !!task.dueDate && task.dueDate < now;
    const verificationReasons = attentionVerificationReasons(task);
    const urgency = verificationReasons.length ? 'Verify recommendation' : overdue ? 'Overdue' : intel.amiAttentionScore >= 70 ? 'High priority' : 'Normal';
    return { ...task, closed, recorded, overdue, urgency, verificationReasons };
  });
  const active = categorized.filter(isOpenAttentionTask);
  const history = categorized.filter(task => task.closed || !!task.recorded);
  const brief = dailyBrief(active);
  const featuredIds = new Set(brief.topReady.map(task => task.id));
  const selected = (view === 'active' ? active.filter(task => !featuredIds.has(task.id)) : history)
    .filter(task => (priority !== 'overdue' || task.overdue) && (priority !== 'verify' || task.verificationReasons.length > 0))
    .sort((a, b) => Number(a.verificationReasons.length > 0) - Number(b.verificationReasons.length > 0) || Number(b.overdue) - Number(a.overdue)
      || (b.intelligence?.amiAttentionScore ?? 0) - (a.intelligence?.amiAttentionScore ?? 0)
      || (b.clickupUpdatedAt?.getTime() ?? 0) - (a.clickupUpdatedAt?.getTime() ?? 0) || a.id - b.id);
  const total = selected.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const tasks = selected.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const highCount = active.filter(task => task.urgency === 'High priority' || task.overdue).length;
  const overdueCount = active.filter(task => task.overdue).length;
  const verifyCount = active.filter(task => task.verificationReasons.length > 0).length;
  const returnTo = urlFor(activeFilters, currentPage);
  const reviewedCount = history.filter(task => task.recorded === 'REVIEWED').length;
  const dismissedCount = history.filter(task => task.recorded === 'DISMISSED').length;
  const triagedCount = reviewedCount + dismissedCount;
  const triageTotal = active.length + triagedCount;

  return <main className="ops-shell dashboard-shell attention-workspace" id="main-content">
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
      <div><strong>{verifyCount}</strong><span>Recommendations to verify</span></div>
      <div><strong>{importedCount ? Math.round(100 * analyzedCount / importedCount) : 0}%</strong><span>AI analysis coverage</span></div>
    </section>
    <p className="dashboard-note attention-coverage">{analyzedCount.toLocaleString()} of {importedCount.toLocaleString()} imported tasks analyzed across active clients. Unanalyzed tasks cannot appear here. Human reviews are stored only in this app.</p>
    {params.notice === 'stale' && <p className="attention-notice" role="status">This task's AI assessment changed. Review its latest context before updating it.</p>}
    <section className="clean-panel attention-panel attention-brief-panel" aria-labelledby="daily-brief-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">DAILY DECISION BRIEF</p>
          <h2 id="daily-brief-title">Ami's priorities</h2>
          <p>Based on currently analyzed, open recommendations in {selectedGroup ? selectedGroup.canonical.name : 'active JF Corporate clients'}. Review ClickUp evidence before taking action.</p>
        </div>
        <Link href="/review?filter=unreviewed" className="task-action">Audit AI recommendations ↗</Link>
      </div>
      <div className="detail-stat-strip" aria-label="Daily decision summary">
        <div><strong>{brief.ready}</strong><span>Ready for review</span></div>
        <div><strong>{brief.verify}</strong><span>Verify AI evidence</span></div>
        <div><strong>{brief.overdueReady}</strong><span>Past due and ready for review</span></div>
      </div>
      <div className="attention-progress" aria-label="Review progress">
        <p><strong>{triagedCount} of {triageTotal}</strong> current recommendations triaged · {reviewedCount} reviewed · {dismissedCount} dismissed · {active.length} remaining</p>
        <div className="attention-progress-track" role="img" aria-label={`${reviewedCount} reviewed, ${dismissedCount} dismissed, ${active.length} remaining out of ${triageTotal} recommendations`}>
          <span className="attention-progress-reviewed" style={{ width: `${triageTotal ? 100 * reviewedCount / triageTotal : 0}%` }} />
          <span className="attention-progress-dismissed" style={{ width: `${triageTotal ? 100 * dismissedCount / triageTotal : 0}%` }} />
        </div>
        <div className="attention-progress-legend"><span><i className="attention-legend-reviewed" /> Reviewed ({reviewedCount})</span><span><i className="attention-legend-dismissed" /> Dismissed ({dismissedCount})</span><span><i className="attention-legend-remaining" /> Remaining ({active.length})</span></div>
      </div>
      <div className="attention-brief-content">
        <div className="attention-brief-section">
          <div className="attention-brief-section-body">
            <h3>Review these three decisions first</h3>
            <p>Open the evidence, choose Mark reviewed or Dismiss, and the next priority automatically appears. Featured decisions are not repeated in the queue below.</p>
            {brief.topReady.length ? brief.topReady.map((task, index) => <article className="attention-brief-card" key={task.id}>
              <div className="attention-row-main">
                <div className="attention-row-byline"><span className="attention-brief-index">{index + 1}</span><span>{task.client.name}</span>{task.overdue && <span className="attention-urgency overdue">Overdue</span>}</div>
                <h3>{task.name}</h3>
                <p className="attention-row-action">{task.intelligence?.amiAction || 'Review current task context.'}</p>
                <div className="attention-meta">{task.dueDate && <span>Due: {dateLabel(task.dueDate)}</span>}</div>
              </div>
              <div className="attention-row-actions">
                <div className="attention-primary-review"><TaskDetailsButton taskId={task.id} label="Review evidence" /></div>
                {task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
                <form action={setAttentionDecision} className="attention-decision-form">
                  <details className="attention-reason"><summary>Add dismissal reason (optional)</summary><label>Reason<select name="reason" defaultValue=""><option value="">No reason</option><option value="ALREADY_HANDLED">Already handled</option><option value="NOT_RELEVANT">Not relevant</option><option value="INCORRECT_AI">Incorrect AI recommendation</option><option value="OTHER">Other</option></select></label></details>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="fingerprint" value={attentionFingerprint(task.intelligence!)} />
                  <input type="hidden" name="returnTo" value="/attention" />
                  <button type="submit" name="decision" value="REVIEWED" title="Archive this recommendation without changing ClickUp">Mark reviewed</button>
                  <button type="submit" name="decision" value="DISMISSED" className="attention-dismiss" title="Dismiss this recommendation and show the next one">Dismiss</button>
                </form>
              </div>
            </article>) : <p>You're caught up with the currently analyzed recommendations.</p>}
            {brief.ready > brief.topReady.length && <p className="dashboard-note">{brief.ready - brief.topReady.length} more ready decisions will appear as these are reviewed.</p>}
          </div>
        </div>
        {brief.topToVerify.length > 0 && <div className="attention-brief-section attention-verify-section">
          <div className="attention-brief-section-body">
            <h3>Validate before acting</h3>
            {brief.topToVerify.map(task => <p key={task.id}><strong>{task.client.name}:</strong> {task.name} — {task.verificationReasons.join('; ')}. <TaskDetailsButton taskId={task.id} label="Review context" /></p>)}
            <Link href={urlFor({ ...activeFilters, priority: 'verify', view: 'active' })}>See all {brief.verify} recommendations needing verification →</Link>
          </div>
        </div>}
      </div>
      <p className="dashboard-note">This is a rule-based summary, not a new AI analysis. Counts exclude tasks without saved intelligence and do not establish that all client work has been reviewed.</p>
    </section>
    <section className="clean-panel attention-panel attention-queue-panel" aria-labelledby="inbox-title">
      <div className="panel-heading">
        <div><p className="eyebrow">ACTION QUEUE</p><h2 id="inbox-title">{view === 'active' ? 'Other open decisions' : 'Reviewed & archived'}</h2><p>{view === 'active' ? 'Additional decisions not featured above. Past-due items first.' : 'Completed tasks and decisions you have reviewed or dismissed.'}</p></div>
        <span className="panel-count">{total}</span>
      </div>
      <nav className="attention-view-tabs" aria-label="Inbox view">
        <Link aria-current={view === 'active' ? 'page' : undefined} href={urlFor({ ...activeFilters, view: 'active' })}>Other open decisions ({active.length - brief.topReady.length})</Link>
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
            <option value="verify">Needs verification</option>
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
              <div className="attention-row-byline"><span>{task.client.name}</span><span className={task.verificationReasons.length ? 'attention-urgency normal' : task.overdue ? 'attention-urgency overdue' : intel.amiAttentionScore >= 70 ? 'attention-urgency high' : 'attention-urgency normal'}>{task.closed ? 'Completed in ClickUp / AI' : task.recorded ? (task.recorded === 'REVIEWED' ? 'Reviewed' : 'Dismissed') : task.urgency}</span></div>
              <h3>{task.name}</h3>
              <p className="attention-row-action">{intel.amiAction || intel.currentSummary || 'Review the task for next steps.'}</p>
              {task.verificationReasons.length > 0 && <p className="attention-notice" role="note"><strong>Verify before acting:</strong> {task.verificationReasons.join('; ')}. Check the latest ClickUp comments and task status.</p>}
              <div className="attention-meta">
                {task.dueDate && <span className={task.overdue ? 'attention-overdue' : ''}>{task.overdue ? 'Past due' : 'Due'}: {dateLabel(task.dueDate)}</span>}
                {intel.waitingOnName && <span>Waiting on: {intel.waitingOnName}</span>}
                {intel.analyzedAt && <span>Analyzed: {dateLabel(intel.analyzedAt)}</span>}
                {intel.confidence != null && <span>AI confidence: {Math.round(intel.confidence * 100)}%</span>}
              </div>
            </div>
            <div className="attention-row-actions">
              <div className="attention-queue-primary"><TaskDetailsButton taskId={task.id} label="Review context" /></div>
              {task.clickupUrl && <a className="task-action" href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
              {view === 'history' && task.recorded && !task.closed && <form action={setAttentionDecision} className="attention-decision-form">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="fingerprint" value={attentionFingerprint(intel)} />
                <input type="hidden" name="returnTo" value="/attention" />
                <button type="submit" name="decision" value="REOPEN">Reopen decision</button>
              </form>}
              {view === 'active' && <details className="attention-queue-more"><summary>Decision options</summary><form action={setAttentionDecision} className="attention-decision-form">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="fingerprint" value={attentionFingerprint(intel)} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit" name="decision" value="REVIEWED" title="Remove from open inbox; no changes to ClickUp">Mark reviewed</button>
                <button type="submit" name="decision" value="DISMISSED" className="attention-dismiss" title="Dismiss this AI recommendation; no changes to ClickUp">Dismiss</button>
              </form></details>}
            </div>
          </article>;
        })}</div>}
      <nav className="attention-pagination" aria-label="Inbox pages">
        <span>Page {currentPage} of {totalPages} · {total} matching</span>
        <div>{currentPage > 1 && <Link href={urlFor(activeFilters, currentPage - 1)}>← Previous</Link>}{currentPage < totalPages && <Link href={urlFor(activeFilters, currentPage + 1)}>Next →</Link>}</div>
      </nav>
    </section>
    <p className="dashboard-note">Items marked for verification remain visible, but should not be treated as confirmed current requests. The AI may have missed later comments or have incomplete context.</p>
    <p className="dashboard-note">Reviewing or dismissing an AI recommendation does not close, update, or acknowledge a ClickUp task. New AI assessments may bring a previously reviewed task back into the open inbox.</p>
  </main>;
}
