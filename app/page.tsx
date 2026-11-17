import { AppNav } from './components/app-nav';
import { TaskDetailsButton } from './components/task-details';
import { markBriefItemDone, markBriefReviewed } from './actions';
import { loadCommandCenter } from '@/lib/brief/command-center';

export const dynamic = 'force-dynamic';

const dateTime = (date: Date | null) => date ? date.toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
}) : 'Unavailable';
const stateLabel = (value: string | null | undefined) => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'Current issue';
const readinessReasons: Record<string, string> = {
  ai_worker_heartbeat_missing: 'The AI analysis worker has not reported in yet.',
  ai_worker_failed: 'The AI analysis worker reported a failure.',
  ai_worker_heartbeat_stale: 'The AI analysis worker has stopped reporting.',
  ai_stale_leases: 'One or more interrupted AI jobs still need recovery.',
  ai_queue_stale: 'Current-work analysis jobs have waited too long.',
  sync_worker_heartbeat_missing: 'The ClickUp sync worker has not reported in yet.',
  sync_worker_failed: 'The ClickUp sync worker reported a failure.',
  sync_worker_heartbeat_stale: 'The ClickUp sync worker has stopped reporting.',
  client_sync_missing: 'One or more current client folders have never synchronized.',
  client_sync_stale: 'One or more current client folders need a newer ClickUp sync.',
  operational_analysis_coverage_low: 'Too little current work has passed evidence analysis.',
  unverified_action_candidates_present: 'Potential Ami decisions still need evidence verification.'
};

function DoneToday({ itemKey, taskId, fingerprint }: { itemKey: string; taskId: number; fingerprint: string | null }) {
  return <form action={markBriefItemDone}>
    <input type="hidden" name="itemKey" value={itemKey} />
    <input type="hidden" name="taskId" value={taskId} />
    <input type="hidden" name="fingerprint" value={fingerprint ?? ''} />
    <button className="brief-done-button" type="submit">Done for today</button>
  </form>;
}

export default async function Home() {
  const brief = await loadCommandCenter();
  const remaining = brief.actionTotal + brief.changeTotal + brief.riskTotal;
  return <main className="ops-shell dashboard-shell brief-shell command-center" id="main-content">
    <AppNav current="overview" />
    <header className="brief-hero"><div>
      <p className="eyebrow">AMI'S WORKDAY · {brief.current.key}</p>
      <h1>Start here before ClickUp</h1>
      <p>See what needs you, what changed, and where to look next—without sorting through every notification.</p>
      <div className="brief-window"><span>Updates since {dateTime(brief.current.previousStart)} ET</span><span>{brief.reviewedToday} item{brief.reviewedToday === 1 ? '' : 's'} reviewed today</span></div>
    </div><form action={markBriefReviewed}><button className="digest-button brief-reviewed-button" type="submit">{brief.completedAt ? 'Brief completed · update time' : 'Finish daily brief'}</button></form></header>

    <section className={`command-readiness ${brief.readiness.ready ? 'ready' : 'limited'}`} aria-label="Data readiness">
      <div><strong>{brief.readiness.ready ? 'Current and ready' : 'Coverage is limited'}</strong><span>{brief.readiness.ready ? 'ClickUp sync and operational analysis are current.' : 'Use the verified items below, but do not treat an empty section as proof that nothing needs attention.'}</span></div>
      <dl><div><dt>Current-work coverage</dt><dd>{brief.readiness.operationalCoveragePercent}%</dd></div><div><dt>Operational tasks</dt><dd>{brief.readiness.analyzedOperationalTasks}/{brief.readiness.operationalTasks}</dd></div><div><dt>Oldest client sync</dt><dd>{dateTime(brief.readiness.oldestSyncAt)}</dd></div></dl>
      <small className="command-scope-note">Current work means open JF Corporate work updated in the last 30 days, due from 7 days ago through the next 14 days, or carrying a current evidence-verified decision, blocker, dependency, or high-risk signal.</small>
      {!brief.readiness.ready && <details><summary>Why coverage is limited</summary><ul>{brief.readiness.reasons.map(reason => <li key={reason}>{readinessReasons[reason] ?? reason.replaceAll('_', ' ')}</li>)}</ul><a href="/system">Open system status →</a></details>}
    </section>

    <section className="clean-panel brief-section command-primary" aria-labelledby="start-title">
      <div className="panel-heading"><div><p className="eyebrow">1 · START HERE</p><h2 id="start-title">{brief.actions.length ? `Your next ${brief.actions.length} decision${brief.actions.length === 1 ? '' : 's'}` : 'No verified action is ready'}</h2><p>Only current, evidence-backed requests where you are the next actor appear here.</p></div><a href="/attention">Open My Decisions →</a></div>
      {brief.actions.length ? <div className="brief-task-list">{brief.actions.map(task => {
        const intel = task.intelligence!;
        const reasons = Array.isArray(intel.priorityReasons) ? intel.priorityReasons.filter((reason): reason is string => typeof reason === 'string') : [];
        return <article className="brief-task-row command-action" key={task.itemKey}><div className="brief-task-main">
          <div className="brief-task-meta"><span>{task.client.name}</span><span className="brief-tag">{intel.priorityLevel ?? 'Current'} priority</span>{task.dueDate && <span>Due {dateTime(task.dueDate)}</span>}</div>
          <h3>{intel.amiAction || task.name}</h3><p><strong>Task:</strong> {task.name}</p>
          {reasons[0] && <small><strong>Why now:</strong> {reasons[0]}</small>}
        </div><div className="brief-task-actions"><TaskDetailsButton taskId={task.id} label="Evidence" />{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">Open ClickUp ↗</a>}<DoneToday itemKey={task.itemKey} taskId={task.id} fingerprint={task.fingerprint} /></div></article>;
      })}</div> : <div className="brief-empty"><strong>{brief.readiness.ready ? 'No verified action is waiting on Ami' : 'No verified action is visible in the current analyzed scope'}</strong><p>{brief.readiness.ready ? 'New unresolved requests will appear here automatically.' : 'Analysis coverage must recover before this can be treated as a complete inbox.'}</p></div>}
      {brief.actionTotal > brief.actions.length && <p className="brief-footnote">{brief.actionTotal - brief.actions.length} more verified decision{brief.actionTotal - brief.actions.length === 1 ? '' : 's'} available in My Decisions.</p>}
    </section>

    <div className="command-grid">
      <section className="clean-panel brief-section" aria-labelledby="changed-title"><div className="panel-heading"><div><p className="eyebrow">2 · WHAT CHANGED</p><h2 id="changed-title">Meaningful developments</h2><p>Decisions, blockers, handoffs, completions, and reopenings—not raw notification activity.</p></div><a href="/changes">See all →</a></div>
        {brief.changes.length ? <div className="brief-task-list">{brief.changes.map(update => <article className="brief-task-row" key={update.itemKey}><div className="brief-task-main"><div className="brief-task-meta"><span>{update.task.client.name}</span><span className="brief-tag">{stateLabel(update.kind)}</span><span>{dateTime(update.evidenceAt ?? update.createdAt)}</span></div><h3>{update.task.name}</h3><p>{update.summary}</p></div><div className="brief-task-actions"><TaskDetailsButton taskId={update.taskId} label="Context" />{update.task.clickupUrl && <a href={update.task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}<DoneToday itemKey={update.itemKey} taskId={update.taskId} fingerprint={update.fingerprint} /></div></article>)}</div> : <div className="brief-empty"><strong>No new verified developments</strong><p>{brief.readiness.ready ? 'Material changes since the prior workday will appear here.' : 'Coverage is limited; this is not confirmation that no work changed.'}</p></div>}
      </section>

      <section className="clean-panel brief-section" aria-labelledby="watch-title"><div className="panel-heading"><div><p className="eyebrow">3 · WATCH TODAY</p><h2 id="watch-title">Current blockers and risks</h2><p>Recent, analyzed work that may need management awareness.</p></div></div>
        {brief.risks.length ? <div className="brief-task-list">{brief.risks.map(task => <article className="brief-task-row" key={task.itemKey}><div className="brief-task-main"><div className="brief-task-meta"><span>{task.client.name}</span><span className="brief-tag">{stateLabel(task.intelligence?.agentState)}</span></div><h3>{task.name}</h3><p>{task.intelligence?.currentSummary || 'Open the evidence to review the current issue.'}</p><small>{task.intelligence?.waitingOnName ? `Waiting on ${task.intelligence.waitingOnName}` : 'Current operational risk'}</small></div><div className="brief-task-actions"><TaskDetailsButton taskId={task.id} label="Context" />{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}<DoneToday itemKey={task.itemKey} taskId={task.id} fingerprint={task.fingerprint} /></div></article>)}</div> : <div className="brief-empty"><strong>No verified blocker is on today’s watchlist</strong><p>{brief.readiness.ready ? 'New serious risks will appear here.' : 'Coverage is limited; inspect clients directly if needed.'}</p></div>}
      </section>
    </div>

    <section className="clean-panel command-exceptions" aria-labelledby="exceptions-title"><div className="panel-heading"><div><p className="eyebrow">DRILL DOWN</p><h2 id="exceptions-title">Clients and teammates with current signals</h2><p>Open a detail view only when today’s evidence gives you a reason.</p></div></div>
      <div className="exception-groups"><div><div className="exception-heading"><h3>Clients</h3><a href="/clients">All clients →</a></div>
        {brief.clients.length ? <div className="command-client-grid">{brief.clients.map(client => <a href={`/clients/${client.slug}`} key={client.slug}><strong>{client.name}</strong><span>{client.decisions} decision{client.decisions === 1 ? '' : 's'} · {client.risks} risk{client.risks === 1 ? '' : 's'} · {client.changes} change{client.changes === 1 ? '' : 's'}</span><small>Open current situation →</small></a>)}</div> : <p className="brief-empty">No client exception is available in the current verified scope.</p>}
      </div><div><div className="exception-heading"><h3>Team</h3><a href="/team">All teammates →</a></div>
        {brief.team.length ? <div className="command-client-grid">{brief.team.map(person => <a href={`/employees/${person.id}`} key={person.id}><strong>{person.name}</strong><span>{person.decisions} decision{person.decisions === 1 ? '' : 's'} · {person.risks} risk{person.risks === 1 ? '' : 's'} · {person.changes} change{person.changes === 1 ? '' : 's'}</span><small>Open current workload →</small></a>)}</div> : <p className="brief-empty">No teammate exception is available in the current verified scope.</p>}
      </div></div>
    </section>
    <p className="brief-footnote">{remaining ? `${remaining} current item${remaining === 1 ? '' : 's'} remain before today’s review is complete.` : brief.readiness.ready ? 'Today’s verified brief is clear.' : 'Readiness must recover before the brief can be considered complete.'}</p>
  </main>;
}
