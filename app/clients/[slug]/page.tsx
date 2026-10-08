import { isStaleActive, activityLabel } from '@/lib/intelligence/staleness';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const label: Record<string,string> = {
  WAITING_ON_AMI:'Waiting on Ami', WAITING_ON_TEAM:'Waiting on team', WAITING_ON_CLIENT:'Waiting on client',
  WAITING_ON_VENDOR:'Waiting on vendor', BLOCKED:'Blocked', ISSUE:'Issue', ACTIVE:'Active', COMPLETED:'Completed',
  NEEDS_REVIEW:'Needs review', NOT_STARTED:'Not started', UNKNOWN:'Unknown'
};

export default async function ClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await prisma.client.findUnique({ where: { slug } });
  if (!client) notFound();

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false, intelligence: { isNot: null } },
    include: { intelligence: true, list: true, comments: { select: { clickupCreatedAt: true, clickupUpdatedAt: true } }, assignees: { include: { employee: true } } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }]
  });
  const needsAmi = tasks.filter(t => t.intelligence?.needsAmi);
  const waiting = tasks.filter(t => t.intelligence?.waitingOnType !== 'NONE' && !t.intelligence?.needsAmi);
  const active = tasks.filter(t => t.intelligence?.agentState === 'ACTIVE');

  const stale = active.filter(t => isStaleActive({ state: 'ACTIVE', taskUpdatedAt: t.clickupUpdatedAt, commentDates: t.comments.flatMap(c => [c.clickupCreatedAt, c.clickupUpdatedAt]) }));
  const recentActive = active.filter(t => !stale.includes(t));

  return <main className="ops-shell">
    <a className="back-link" href="/">← Ami Intelligence</a>
    <header className="detail-header"><p className="eyebrow">CLIENT INTELLIGENCE</p><h1>{client.name}</h1><p className="muted">{tasks.length} analyzed tasks · {needsAmi.length} need Ami · {waiting.length} waiting · {recentActive.length} recently active · {stale.length} stale</p></header>

    {!!needsAmi.length && <section className="attention-section"><div className="section-heading"><h2>Needs Ami</h2><span className="count-badge attention-count">{needsAmi.length}</span></div>{needsAmi.map(t => <TaskCard key={t.id} task={t} />)}</section>}

    <section className="detail-grid">
      <div className="ops-section"><div className="section-heading"><h2>Waiting</h2><span className="count-badge">{waiting.length}</span></div>{waiting.map(t => <TaskCard key={t.id} task={t} />)}</div>
      <div className="ops-section"><div className="section-heading"><h2>Recently active</h2><span className="count-badge">{recentActive.length}</span></div>{recentActive.slice(0,20).map(t => <TaskCard key={t.id} task={t} compact />)}{recentActive.length > 20 && <p className="muted">+ {recentActive.length - 20} more recently active tasks</p>}</div>
    </section>
    <section className="ops-section" style={{ marginTop: 18 }}><div className="section-heading"><div><p className="eyebrow">REVIEW SIGNAL · 30 DAYS</p><h2>Stale active tasks</h2></div><span className="count-badge">{stale.length}</span></div><p className="muted">No recorded task or comment activity in the last 30 days. Review these before assuming they are still progressing.</p>{stale.map(t => <TaskCard key={t.id} task={t} compact />)}</section>
  </main>;
}

function TaskCard({ task, compact=false }: { task: any; compact?: boolean }) {
  const intel = task.intelligence;
  return <article className="detail-task"><div className="task-kicker">{task.list.name} · {label[intel.agentState] ?? intel.agentState}</div><strong>{task.name}</strong>{!compact && <p>{intel.currentSummary}</p>}<div className="task-meta"><span>{activityLabel({ state: intel.agentState, taskUpdatedAt: task.clickupUpdatedAt, commentDates: task.comments.flatMap((c:any) => [c.clickupCreatedAt, c.clickupUpdatedAt]) })}</span><span>{task.assignees.map((a:any)=>a.employee.name).join(', ') || 'Unassigned'}</span>{intel.waitingOnName && <span>Waiting on {intel.waitingOnName}</span>}{task.clickupUrl && <a href={task.clickupUrl} target="_blank" rel="noreferrer">ClickUp →</a>}</div></article>;
}
