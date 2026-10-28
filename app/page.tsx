import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { AppNav } from './components/app-nav';
import { TaskDetailsButton } from './components/task-details';
import { markBriefReviewed } from './actions';
import { buildDailyBrief, briefSince, DAILY_BRIEF_COOKIE, formatEastern, type BriefTask } from '@/lib/brief/daily-brief';

export const dynamic = 'force-dynamic';
const stateLabel = (value: string | null) => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase()) : 'Not analyzed';
const dayLabel = (value: Date | null) => value ? value.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
const evidenceLabel = (task: BriefTask) => `${task.evidenceAt ? `Evidence ${formatEastern(task.evidenceAt)}` : 'Evidence time unavailable'} · ${task.analyzedAt ? `Analyzed ${formatEastern(task.analyzedAt)}` : 'Not analyzed'}`;

function BriefTaskRow({ task, progress = false }: { task: BriefTask; progress?: boolean }) {
  return <article className="brief-task-row">
    <div className="brief-task-main">
      <div className="brief-task-meta"><span>{task.clientName}</span><span className={`brief-tag ${progress ? 'brief-tag-progress' : ''}`}>{progress ? 'Progress' : task.overdue ? 'Overdue' : stateLabel(task.state)}</span>{task.dueDate && <span>Due {dayLabel(task.dueDate)}</span>}</div>
      <h3>{task.name}</h3><p>{task.action || task.summary || (progress ? 'Recorded as completed during this reporting window.' : 'Open the task to verify the latest context.')}</p><small>{evidenceLabel(task)}</small>
    </div>
    <div className="brief-task-actions"><TaskDetailsButton taskId={task.id} label="Evidence" />{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}</div>
  </article>;
}

export default async function Home() {
  const now = new Date();
  const jar = await cookies();
  const since = briefSince(jar.get(DAILY_BRIEF_COOKIE)?.value, now);
  const [clients, tasks, changes] = await Promise.all([
    prisma.client.findMany({ where: { active: true, space: { name: 'JF Corporate' } }, select: { id: true, name: true, slug: true, clickupFolderId: true, lastSyncedAt: true } }),
    prisma.task.findMany({ where: { client: { active: true, space: { name: 'JF Corporate' } } }, select: {
      id: true, name: true, clientId: true, clickupUrl: true, clickupStatus: true, dueDate: true, clickupUpdatedAt: true, deleted: true,
      comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } }, attentionDisposition: { select: { sourceFingerprint: true, decision: true } },
      intelligence: { select: { agentState: true, needsAmi: true, amiAction: true, currentSummary: true, waitingOnType: true, waitingOnName: true, importanceScore: true, amiAttentionScore: true, riskLevel: true, lastMeaningfulChange: true, lastMeaningfulChangeAt: true, sourceFingerprint: true, analyzedAt: true } }
    } }),
    prisma.intelligenceChange.findMany({ where: { detectedAt: { gte: since }, task: { client: { active: true, space: { name: 'JF Corporate' } } } }, select: { taskId: true, nextState: true, nextNeedsAmi: true, detectedAt: true } })
  ]);
  const brief = buildDailyBrief({ now, since, clients, tasks, changes });
  const warnings = [
    brief.coverage.percent < 100 ? `${brief.coverage.imported - brief.coverage.analyzed} imported tasks do not have saved intelligence.` : null,
    brief.coverage.staleClientCount ? `${brief.coverage.staleClientCount} imported folder${brief.coverage.staleClientCount === 1 ? '' : 's'} have not synced successfully in the last 30 minutes.` : null,
    !brief.coverage.oldestSyncAt ? 'No successful client synchronization timestamp is available.' : null
  ].filter((warning): warning is string => !!warning);

  return <main className="ops-shell dashboard-shell brief-shell" id="main-content">
    <AppNav current="overview" />
    <header className="brief-hero"><div><p className="eyebrow">AMI DAILY EXECUTIVE BRIEF</p><h1>What needs your attention today</h1><p>Current decisions, emerging risks, recent progress, and client health—assembled from stored ClickUp intelligence.</p><div className="brief-window"><span>Since {formatEastern(brief.since)}</span><span>Generated {formatEastern(brief.generatedAt)}</span></div></div><form action={markBriefReviewed}><button className="digest-button brief-reviewed-button" type="submit">Mark brief reviewed</button></form></header>

    <section className="brief-trust-bar" aria-label="Report coverage and freshness">
      <div><strong>{brief.coverage.percent}%</strong><span>Coverage</span><small>{brief.coverage.analyzed} analyzed / {brief.coverage.imported} imported</small></div>
      <div><strong>{brief.coverage.oldestSyncAt ? dayLabel(brief.coverage.oldestSyncAt) : 'Unknown'}</strong><span>Oldest successful sync</span><small>{brief.coverage.oldestSyncAt ? formatEastern(brief.coverage.oldestSyncAt) : 'No sync evidence'}</small></div>
      <div><strong>{brief.clients.length}</strong><span>Client groups</span><small>Active canonical clients</small></div>
    </section>
    {warnings.length > 0 && <aside className="brief-warning" aria-label="Data quality warnings"><strong>Read with care</strong><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><a href="/system">View system status ↗</a></aside>}

    <section className="brief-metrics" aria-label="Executive totals">
      <a href="#decisions"><span>Decisions for Ami</span><strong>{brief.totals.decisions}</strong><small>{brief.decisions.filter(task => task.overdue).length} overdue</small></a>
      <a href="#risks"><span>Blocked or high risk</span><strong>{brief.totals.blocked}</strong><small>{brief.newRisks.length} changed in this window</small></a>
      <a href="#clients"><span>All overdue work</span><strong>{brief.totals.overdue}</strong><small>Across imported tasks</small></a>
      <a href="#clients"><span>Stale active work</span><strong>{brief.totals.stale}</strong><small>30+ days since source activity</small></a>
      <a href="#progress"><span>Completed since review</span><strong>{brief.totals.completedSince}</strong><small>{brief.totals.externalDependencies} external dependencies</small></a>
    </section>

    <div className="brief-report-grid"><div className="brief-report-primary">
      <section className="clean-panel brief-section" id="decisions"><div className="panel-heading"><div><p className="eyebrow">FIRST PRIORITY</p><h2>Decisions for Ami</h2><p>Open recommendations, excluding decisions already reviewed or dismissed for the current evidence.</p></div><a href="/attention">Open action inbox ↗</a></div>{brief.decisions.length ? <div className="brief-task-list">{brief.decisions.map(task => <BriefTaskRow key={task.id} task={task} />)}</div> : <div className="brief-empty"><strong>No open decisions found</strong><p>{brief.coverage.percent < 100 ? 'This applies only to analyzed tasks; incomplete coverage may hide requests.' : 'All currently analyzed recommendations have been cleared.'}</p></div>}</section>
      <section className="clean-panel brief-section" id="risks"><div className="panel-heading"><div><p className="eyebrow">SINCE LAST REVIEW</p><h2>New risks and stalled work</h2><p>Current high-risk, blocked, or issue tasks with new evidence or analysis in this reporting window.</p></div><a href="/changes">View recent updates ↗</a></div>{brief.newRisks.length ? <div className="brief-task-list">{brief.newRisks.map(task => <BriefTaskRow key={task.id} task={task} />)}</div> : <div className="brief-empty"><strong>No newly detected risks</strong><p>Existing risks remain visible in the client sections below.</p></div>}</section>
      <section className="clean-panel brief-section" id="progress"><div className="panel-heading"><div><p className="eyebrow">MOVING FORWARD</p><h2>Meaningful progress</h2><p>Tasks recorded as completed since the last brief review.</p></div><a href="/changes">Review all activity ↗</a></div>{brief.progress.length ? <div className="brief-task-list">{brief.progress.map(task => <BriefTaskRow key={task.id} task={task} progress />)}</div> : <div className="brief-empty"><strong>No completed work detected in this window</strong><p>This is different from having no ClickUp activity; open Recent updates for comments and field changes.</p></div>}</section>
    </div><aside className="brief-report-aside"><section className="clean-panel brief-guide"><p className="eyebrow">HOW TO READ THIS</p><h2>Evidence, not automation</h2><p>This brief summarizes stored task intelligence. It does not call AI when opened and cannot update ClickUp.</p><p>Open <strong>Evidence</strong> to verify comments, dates, ownership, and the saved analysis before acting.</p></section><section className="clean-panel brief-guide"><p className="eyebrow">DEPENDENCIES</p><h2>{brief.totals.externalDependencies} waiting on others</h2><p>Includes current tasks waiting on teammates, clients, or vendors.</p><a href="/search?q=waiting">Find dependency tasks ↗</a></section></aside></div>

    <section className="brief-clients" id="clients"><div className="brief-clients-heading"><div><p className="eyebrow">FULL CLIENT REPORT</p><h2>Client health</h2><p>Every active client group, ordered by decisions and operational risk.</p></div><a href="/clients">Open client directory ↗</a></div>
      <div className="brief-client-list">{brief.clients.map(client => <details className={`brief-client ${client.healthy ? 'brief-client-healthy' : ''}`} key={client.slug} open={!client.healthy}><summary><span className="brief-client-title"><span className="entity-avatar">{client.name.slice(0, 1).toUpperCase()}</span><span><strong>{client.name}</strong><small>{client.analyzed} analyzed / {client.imported} imported</small></span></span><span className="brief-client-signals">{client.decisions.length > 0 && <span className="client-signal decision">{client.decisions.length} for Ami</span>}{client.overdue > 0 && <span className="client-signal overdue">{client.overdue} overdue</span>}{client.blocked > 0 && <span className="client-signal blocked">{client.blocked} blocked</span>}{client.healthy && <span className="client-signal quiet">No flagged issues in analyzed tasks</span>}</span><span className="brief-client-chevron" aria-hidden="true">⌄</span></summary>
        <div className="brief-client-body"><div className="brief-client-overview"><div><strong>{client.decisions.length}</strong><span>Decisions</span></div><div><strong>{client.risks.length}</strong><span>Active risks</span></div><div><strong>{client.dependencies.length}</strong><span>Dependencies</span></div><div><strong>{client.progress.length}</strong><span>Completed</span></div></div>
          {client.imported > client.analyzed && <p className="brief-client-caution">Coverage is incomplete: {client.imported - client.analyzed} task{client.imported - client.analyzed === 1 ? '' : 's'} lack saved intelligence.</p>}
          {client.decisions.length > 0 && <div className="brief-client-group"><h3>Needs Ami</h3>{client.decisions.slice(0, 5).map(task => <BriefTaskRow key={task.id} task={task} />)}</div>}
          {client.risks.some(task => !client.decisions.some(decision => decision.id === task.id)) && <div className="brief-client-group"><h3>Risks and blockers</h3>{client.risks.filter(task => !client.decisions.some(decision => decision.id === task.id)).slice(0, 5).map(task => <BriefTaskRow key={task.id} task={task} />)}</div>}
          {client.dependencies.length > 0 && <div className="brief-client-dependencies"><h3>Waiting on others</h3><ul>{client.dependencies.slice(0, 8).map(task => <li key={task.id}><span><strong>{task.name}</strong><small>{task.waitingOnName || stateLabel(task.waitingOnType)} · {evidenceLabel(task)}</small></span><TaskDetailsButton taskId={task.id} label="Evidence" /></li>)}</ul></div>}
          {client.healthy && client.progress.length === 0 && <div className="brief-empty"><strong>No current issues found in analyzed tasks</strong><p>This is not a guarantee of client health when coverage or synchronization is incomplete.</p></div>}
          {client.progress.length > 0 && <div className="brief-client-progress"><h3>Recent progress</h3>{client.progress.slice(0, 5).map(task => <p key={task.id}><strong>{task.name}</strong><span>{task.summary || 'Recorded as completed.'}</span><small>{evidenceLabel(task)}</small></p>)}</div>}
          <a className="brief-client-link" href={`/clients/${client.slug}`}>Open full client view ↗</a></div></details>)}</div>
      {brief.clients.length === 0 && <div className="brief-empty"><strong>No active clients found</strong><p>Import or activate client folders before relying on this report.</p></div>}
    </section><p className="dashboard-note brief-footnote">“Healthy” means no issues were found in currently analyzed tasks. Always consider the displayed synchronization and coverage warnings.</p>
  </main>;
}
