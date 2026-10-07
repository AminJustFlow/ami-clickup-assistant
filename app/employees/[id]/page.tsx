import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const label: Record<string,string> = {
  WAITING_ON_AMI:'Waiting on Ami', WAITING_ON_TEAM:'Waiting on team', WAITING_ON_CLIENT:'Waiting on client',
  WAITING_ON_VENDOR:'Waiting on vendor', BLOCKED:'Blocked', ISSUE:'Issue', ACTIVE:'Active', COMPLETED:'Completed',
  NEEDS_REVIEW:'Needs review', NOT_STARTED:'Not started', UNKNOWN:'Unknown'
};

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) notFound();

  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null }, assignees: { some: { employeeId } } },
    include: { client: true, intelligence: true, list: true, assignees: { include: { employee: true } } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const needsAmi = tasks.filter(t => t.intelligence?.needsAmi);
  const waiting = tasks.filter(t => t.intelligence?.waitingOnType !== 'NONE' && !t.intelligence?.needsAmi);
  const active = tasks.filter(t => t.intelligence?.agentState === 'ACTIVE');

  return <main className="ops-shell">
    <a className="back-link" href="/">← Ami Intelligence</a>
    <header className="detail-header"><p className="eyebrow">EMPLOYEE INTELLIGENCE</p><h1>{employee.name}</h1><p className="muted">{tasks.length} owned tasks · {waiting.length} waiting · {active.length} active</p></header>
    {!!needsAmi.length && <section className="attention-section"><div className="section-heading"><h2>Needs Ami</h2><span className="count-badge attention-count">{needsAmi.length}</span></div>{needsAmi.map(t => <TaskCard key={t.id} task={t} />)}</section>}
    <section className="detail-grid">
      <div className="ops-section"><div className="section-heading"><h2>Waiting</h2><span className="count-badge">{waiting.length}</span></div>{waiting.map(t => <TaskCard key={t.id} task={t} />)}</div>
      <div className="ops-section"><div className="section-heading"><h2>Active</h2><span className="count-badge">{active.length}</span></div>{active.slice(0,20).map(t => <TaskCard key={t.id} task={t} compact />)}{active.length > 20 && <p className="muted">+ {active.length - 20} more active tasks</p>}</div>
    </section>
  </main>;
}

function TaskCard({ task, compact=false }: { task: any; compact?: boolean }) {
  const intel = task.intelligence;
  return <article className="detail-task"><div className="task-kicker">{task.client.name} · {label[intel.agentState] ?? intel.agentState}</div><strong>{task.name}</strong>{!compact && <p>{intel.currentSummary}</p>}<div className="task-meta">{intel.waitingOnName && <span>Waiting on {intel.waitingOnName}</span>}{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">ClickUp →</a>}</div></article>;
}
