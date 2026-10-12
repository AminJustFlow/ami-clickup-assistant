import { TaskDetailsButton } from './task-details';

type TaskRow = {
  id: number;
  name: string;
  clickupUrl: string | null;
  clickupStatus: string | null;
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
  } | null;
};

const stateLabels: Record<string, string> = {
  WAITING_ON_AMI: 'Waiting on Ami', WAITING_ON_TEAM: 'Waiting on team',
  WAITING_ON_CLIENT: 'Waiting on client', WAITING_ON_VENDOR: 'Waiting on vendor',
  BLOCKED: 'Blocked', ISSUE: 'Issue', ACTIVE: 'In progress',
  COMPLETED: 'Completed', NEEDS_REVIEW: 'Needs review',
  NOT_STARTED: 'Not started', UNKNOWN: 'Unknown'
};

export function CompactTaskRow({ task }: { task: TaskRow }) {
  const intel = task.intelligence;
  const nextAction = intel?.needsAmi ? intel.amiAction : null;
  const summary = nextAction || intel?.currentSummary;
  const owners = task.assignees.map(a => a.employee.name).join(', ') || 'Unassigned';
  const overdue = task.dueDate && task.dueDate.getTime() < Date.now() &&
    intel?.agentState !== 'COMPLETED' && !/complete|closed|done/i.test(task.clickupStatus ?? '');
  return <article className="compact-intel-row">
    <div className="compact-intel-main">
      <div className="compact-intel-meta"><span>{task.client.name} / {task.list.name}</span>
        {overdue && <span className="compact-intel-overdue">Past due</span>}
        <span className="status-pill">{intel ? stateLabels[intel.agentState] ?? intel.agentState : 'Not analyzed'}</span>
      </div>
      <h3>{task.name}</h3>
      {summary && <p className={nextAction ? 'compact-intel-action' : 'compact-intel-summary'}>{summary}</p>}
      <div className="compact-intel-subline"><span>Owner: {owners}</span>
        {intel?.waitingOnName && <span>Waiting on: {intel.waitingOnName}</span>}
        {task.dueDate && <span>Due: {task.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
      </div>
    </div>
    <div className="compact-intel-controls">
      <TaskDetailsButton taskId={task.id} />
      {task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noopener noreferrer">ClickUp ↗</a>}
    </div>
  </article>;
}

export function CompactTaskSection({ title, eyebrow, tasks, sectionId, section, page, query, collapsed = false, emptyMessage = 'No tasks match these filters.' }: {
  title: string;
  eyebrow?: string;
  tasks: TaskRow[];
  sectionId: string;
  section?: string;
  page?: string;
  query: string;
  collapsed?: boolean;
  emptyMessage?: string;
}) {
  const selected = section === sectionId;
  const requested = Number(page);
  const pageNumber = selected && Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 0;
  const limit = pageNumber ? pageNumber * 20 : 8;
  const shown = tasks.slice(0, limit);
  const remaining = tasks.length - shown.length;
  const nextHref = (() => {
    const params = new URLSearchParams(query);
    params.set('section', sectionId);
    params.set('page', String(pageNumber + 1));
    return '?' + params.toString() + '#' + sectionId;
  })();
  const contents = <><div className="compact-intel-list">
    {shown.length ? shown.map(task => <CompactTaskRow key={task.id} task={task} />) : <p className="simple-empty">{emptyMessage}</p>}
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
