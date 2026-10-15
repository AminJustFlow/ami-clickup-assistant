import { isClosedClickUpStatus, hasSpecificAmiAction } from '@/lib/attention/triage';
import { TaskDetailsButton } from './task-details';

type TaskRow = {
  id: number;
  name: string;
  clickupUrl: string | null;
  clickupStatus: string | null;
  clickupPriority?: string | null;
  dueDate?: Date | null;
  client: { name: string };
  list: { name: string };
  assignees: { employee: { name: string } }[];
  intelligence?: {
    agentState: string;
    needsAmi: boolean;
    amiAction: string | null;
    currentSummary: string | null;
    waitingOnName: string | null;
    confidence?: number | null;
    analyzedAt?: Date | null;
  } | null;
};

const stateLabels: Record<string, string> = {
  WAITING_ON_AMI: 'Waiting on Ami', WAITING_ON_TEAM: 'Waiting on team',
  WAITING_ON_CLIENT: 'Waiting on client', WAITING_ON_VENDOR: 'Waiting on vendor',
  BLOCKED: 'Blocked', ISSUE: 'Issue', ACTIVE: 'In progress',
  COMPLETED: 'Completed', NEEDS_REVIEW: 'Needs review',
  NOT_STARTED: 'Not started', UNKNOWN: 'Unknown'
};

export function CompactTaskRow({ task, compact = false }: { task: TaskRow; compact?: boolean }) {
  const intel = task.intelligence;
  const nextAction = intel?.needsAmi && hasSpecificAmiAction(intel.amiAction) ? intel.amiAction : null;
  const summary = intel?.currentSummary;
  const owners = task.assignees.map(a => a.employee.name).join(', ') || 'Unassigned';
  const overdue = Boolean(task.dueDate && task.dueDate.getTime() < Date.now() &&
    intel?.agentState !== 'COMPLETED' && !isClosedClickUpStatus(task.clickupStatus));
  const dueLabel = task.dueDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const priority = task.clickupPriority?.trim();
  return <article className="compact-intel-row client-task-card" style={compact ? { paddingTop: 12, paddingBottom: 12 } : undefined}>
    <div className="compact-intel-main">
      <div className="compact-intel-meta"><span>{task.client.name} / {task.list.name}</span></div>
      <h3>{task.name}</h3>
      <div className="client-task-facts" aria-label="ClickUp task information">
        <span><strong>Assigned:</strong> {owners}</span>
        <span><strong>ClickUp:</strong> {task.clickupStatus ?? 'Unknown'}</span>
        {priority && <span><strong>Priority:</strong> {priority}</span>}
        {dueLabel && <span className={overdue ? 'client-task-due-overdue' : ''}><strong>{overdue ? 'Past due:' : 'Due:'}</strong> {dueLabel}</span>}
      </div>
      {nextAction && <div className="client-task-action"><strong>AI suggested next action · verify in ClickUp</strong><p style={compact ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>{nextAction}</p></div>}
      {!nextAction && summary && <details className="client-task-summary-expand"><summary><strong>AI summary:</strong> <span className="client-task-summary-preview">{summary}</span><span className="client-task-summary-more">Read full summary</span></summary><p>{summary}</p></details>}
      {intel?.needsAmi && !nextAction && <p className="client-task-ai-note">Flagged for Ami review; no specific AI action is available. Open details to verify.</p>}
      {!compact && intel?.waitingOnName && <p className="client-task-waiting"><strong>AI identifies dependency:</strong> {intel.waitingOnName}</p>}
      {!compact && intel && <div className="client-task-ai-state"><span className="status-pill">{stateLabels[intel.agentState] ?? intel.agentState}</span><span>AI assessment · not verified task status</span></div>}
      {!compact && !intel && <div className="client-task-ai-state"><span className="status-pill">Not analyzed</span></div>}
    </div>
    <div className="compact-intel-controls">
      <TaskDetailsButton taskId={task.id} />
      {task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
    </div>
  </article>;
}

export function CompactTaskSection({ title, eyebrow, tasks, sectionId, section, page, query, collapsed = false, initialLimit = 8, compact = false, emptyMessage = 'No tasks match these filters.' }: {
  title: string;
  eyebrow?: string;
  tasks: TaskRow[];
  sectionId: string;
  section?: string;
  page?: string;
  query: string;
  collapsed?: boolean;
  initialLimit?: number;
  compact?: boolean;
  emptyMessage?: string;
}) {
  const selected = section === sectionId;
  const requested = Number(page);
  const pageNumber = selected && Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 0;
  const limit = pageNumber ? pageNumber * 20 : initialLimit;
  const shown = tasks.slice(0, limit);
  const remaining = tasks.length - shown.length;
  const nextHref = (() => {
    const params = new URLSearchParams(query);
    params.set('section', sectionId);
    params.set('page', String(pageNumber + 1));
    return '?' + params.toString() + '#' + sectionId;
  })();
  const contents = <><div className="compact-intel-list">
    {shown.length ? shown.map(task => <CompactTaskRow key={task.id} task={task} compact={compact} />) : <p className="simple-empty">{emptyMessage}</p>}
  </div>
    {remaining > 0 && <div className="compact-intel-more"><span>Showing {shown.length} of {tasks.length}</span><a href={nextHref}>Show {Math.min(20, remaining)} more →</a></div>}
  </>;
  if (collapsed) return <details id={sectionId} className="clean-panel compact-intel-section collapsible-panel" open={selected}>
    <summary>{title}<span>{tasks.length}</span></summary>{contents}
  </details>;
  return <section id={sectionId} className="clean-panel compact-intel-section">
    <div className="panel-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><span className="panel-count">{tasks.length}</span></div>
    {contents}
  </section>;
}
