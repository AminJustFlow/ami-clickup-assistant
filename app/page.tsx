import { cookies } from 'next/headers';
import { Prisma } from '@prisma/client';
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
  return <article className="brief-task-row"><div className="brief-task-main">
    <div className="brief-task-meta"><span>{task.clientName}</span><span className={`brief-tag ${progress ? 'brief-tag-progress' : ''}`}>{progress ? 'Progress' : task.overdue ? 'Overdue' : stateLabel(task.state)}</span>{task.dueDate && <span>Due {dayLabel(task.dueDate)}</span>}</div>
    <h3>{task.name}</h3><p>{task.action || task.summary || (progress ? 'Recorded as completed during this reporting window.' : 'Open the task to verify the latest context.')}</p><small>{evidenceLabel(task)}</small>
    {task.relatedInsights?.length ? <details className="task-extra"><summary>{task.relatedInsights.length} related subtask insight{task.relatedInsights.length === 1 ? '' : 's'}</summary><ul>{task.relatedInsights.map(item => <li key={item.id}><strong>{item.name}</strong>{item.action || item.summary ? ` — ${item.action || item.summary}` : ''}</li>)}</ul></details> : null}
  </div><div className="brief-task-actions"><TaskDetailsButton taskId={task.id} label="Evidence" />{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}</div></article>;
}

export default async function Home() {
  const now = new Date();
  const jar = await cookies();
  const since = briefSince(jar.get(DAILY_BRIEF_COOKIE)?.value, now);
  const [clients, taskRows, changes, parentRows, commentActivity] = await Promise.all([
    prisma.client.findMany({ where: { active: true, space: { name: 'JF Corporate' } }, select: { id: true, name: true, slug: true, clickupFolderId: true, lastSyncedAt: true } }),
    prisma.task.findMany({ where: { client: { active: true, space: { name: 'JF Corporate' } } }, select: {
      id: true, clickupTaskId: true, name: true, clientId: true, clickupUrl: true, clickupStatus: true, dueDate: true, clickupUpdatedAt: true, deleted: true,
      attentionDisposition: { select: { sourceFingerprint: true, decision: true } },
      intelligence: { select: { agentState: true, needsAmi: true, amiAction: true, currentSummary: true, waitingOnType: true, waitingOnName: true, importanceScore: true, amiAttentionScore: true, riskLevel: true, lastMeaningfulChange: true, lastMeaningfulChangeAt: true, sourceFingerprint: true, analyzedAt: true } }
    } }),
    prisma.intelligenceChange.findMany({ where: { detectedAt: { gte: since }, task: { client: { active: true, space: { name: 'JF Corporate' } } } }, select: { taskId: true, nextState: true, nextNeedsAmi: true, detectedAt: true } }),
    prisma.$queryRaw<Array<{ id: number; parentId: string | null }>>(Prisma.sql`
      SELECT t.id,
        CASE jsonb_typeof(t."rawPayload"->'parent')
          WHEN 'string' THEN t."rawPayload"->>'parent'
          WHEN 'object' THEN t."rawPayload"->'parent'->>'id'
          ELSE NULL
        END AS "parentId"
      FROM "Task" t
      JOIN "Client" c ON c.id = t."clientId"
      JOIN "Space" s ON s."clickupSpaceId" = c."clickupSpaceId"
      WHERE c.active = true AND s.name = 'JF Corporate'
    `),
    prisma.comment.groupBy({
      by: ['taskId'],
      where: { task: { client: { active: true, space: { name: 'JF Corporate' } } } },
      _max: { clickupCreatedAt: true, clickupUpdatedAt: true }
    })
  ]);
  const parentByTaskId = new Map(parentRows.map(row => [row.id, row.parentId]));
  const activityByTaskId = new Map(commentActivity.map(row => [row.taskId, row._max]));
  const tasks = taskRows.map(task => {
    const activity = activityByTaskId.get(task.id);
    return {
      ...task,
      rawPayload: { parent: parentByTaskId.get(task.id) ?? null },
      comments: activity ? [{ clickupCreatedAt: activity.clickupCreatedAt, clickupUpdatedAt: activity.clickupUpdatedAt }] : []
    };
  });
  const brief = buildDailyBrief({ now, since, clients, tasks, changes });
  const warnings = [
    brief.coverage.percent < 100 ? `${brief.coverage.imported - brief.coverage.analyzed} imported tasks do not have saved intelligence.` : null,
    brief.coverage.staleClientCount ? `${brief.coverage.staleClientCount} imported folder${brief.coverage.staleClientCount === 1 ? '' : 's'} have not synced successfully in the last 30 minutes.` : null,
    !brief.coverage.oldestSyncAt ? 'No successful client synchronization timestamp is available.' : null
  ].filter((warning): warning is string => !!warning);
  const clientExceptions = brief.clients.filter(client => !client.healthy).length;

  return <main className="ops-shell dashboard-shell brief-shell" id="main-content"><AppNav current="overview" />
    <header className="brief-hero"><div><p className="eyebrow">AMI DAILY BRIEF</p><h1>What needs your attention today</h1><p>Start with the next decision. Everything else can wait until you need it.</p><div className="brief-window"><span>Since {formatEastern(brief.since)}</span><span>Generated {formatEastern(brief.generatedAt)}</span></div></div><form action={markBriefReviewed}><button className="digest-button brief-reviewed-button" type="submit">Mark brief reviewed</button></form></header>

    <details className="brief-warning" aria-label="Data coverage and freshness"><summary><strong>Data confidence: {brief.coverage.percent}% analyzed</strong>{warnings.length ? ` · ${warnings.length} item${warnings.length === 1 ? '' : 's'} to know` : ' · Synced and covered'}</summary><ul>{warnings.length ? warnings.map(warning => <li key={warning}>{warning}</li>) : <li>No current coverage or synchronization warnings.</li>}</ul><a href="/system">System details ↗</a></details>

    <section className="brief-metrics" aria-label="Current overview"><a href="/attention"><span>Decisions for Ami</span><strong>{brief.totals.decisions}</strong><small>Concrete responses or choices</small></a><a href="/clients"><span>Blocked or high risk</span><strong>{brief.totals.blocked}</strong><small>Current intervention signals</small></a><a href="/clients?focus=overdue"><span>All overdue work</span><strong>{brief.totals.overdue}</strong><small>{brief.totals.overdueRecent} recently active · {brief.totals.overdueOlder} older</small></a></section>

    <section className="clean-panel brief-section" id="next-actions"><div className="panel-heading"><div><p className="eyebrow">START HERE</p><h2>{brief.topActions.length ? `Your next ${brief.topActions.length} action${brief.topActions.length === 1 ? '' : 's'}` : 'No immediate action'}</h2><p>Decisions first, then serious blockers. An old due date alone never appears here.</p></div><a href="/attention">Open action inbox ↗</a></div>{brief.topActions.length ? <div className="brief-task-list">{brief.topActions.map(task => <div key={`${task.actionKind}-${task.id}`}><p className="dashboard-note"><strong>{task.actionKind === 'DECISION' ? 'What you need to decide' : 'Why this needs attention'}:</strong> {task.actionReason}</p><BriefTaskRow task={task} /></div>)}</div> : <div className="brief-empty"><strong>You are caught up</strong><p>There are no current analyzed decisions or serious intervention signals for Ami.</p></div>}</section>

    <div className="brief-report-grid"><div className="brief-report-primary"><details className="clean-panel compact-intel-section collapsible-panel" id="risks"><summary>Also monitor<span>{brief.newRisks.length}</span></summary>{brief.newRisks.length ? <div className="brief-task-list">{brief.newRisks.map(task => <BriefTaskRow key={task.id} task={task} />)}</div> : <p className="brief-empty">No newly detected risks since the last review.</p>}</details><details className="clean-panel compact-intel-section collapsible-panel" id="progress"><summary>Recent progress<span>{brief.progress.length}</span></summary>{brief.progress.length ? <div className="brief-task-list">{brief.progress.slice(0, 8).map(task => <BriefTaskRow key={task.id} task={task} progress />)}</div> : <p className="brief-empty">No completed work detected in this review window.</p>}</details></div><aside className="brief-report-aside"><section className="clean-panel brief-guide"><p className="eyebrow">CLIENT EXCEPTIONS</p><h2>{clientExceptions} clients to review</h2><p>Clients with a current decision, risk, or overdue work appear first.</p><a href="/clients">Open clients ↗</a></section><section className="clean-panel brief-guide"><p className="eyebrow">WAITING ON OTHERS</p><h2>{brief.totals.externalDependencies}</h2><p>Current work waiting on teammates, clients, or vendors.</p><a href="/search?q=waiting">Review dependencies ↗</a></section></aside></div>
  </main>;
}
