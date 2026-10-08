import { prisma } from '@/lib/db/prisma';
import { buildTaskContext } from '@/lib/intelligence/context';
import { analyzeWithRules } from '@/lib/intelligence/engine';
import { saveReview } from './actions';

export const dynamic = 'force-dynamic';

const isDone = (status: string | null) => /^(done|complete|completed|closed)$/i.test(status?.trim() ?? '');
const format = (value: string | null | undefined) => value?.replaceAll('_', ' ') ?? 'Unknown';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = 'disagreements' } = await searchParams;
  const tasks = await prisma.task.findMany({
    where: { deleted: false, intelligence: { isNot: null }, comments: { some: {} } },
    include: {
      client: true, list: true, intelligence: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } }, reviewFeedback: true
    },
    orderBy: { clickupUpdatedAt: 'desc' }
  });

  const rows = tasks.map(task => {
    const rules = analyzeWithRules(buildTaskContext(task));
    const saved = task.intelligence!;
    const ai = saved.promptVersion !== 'RULE_ENGINE_V1' && saved.promptVersion != null;
    const flags: { priority: boolean; title: string }[] = [];
    const notes: string[] = [];
    // Disagreement with a heuristic is expected, not itself a quality failure.
    if (ai && rules.agentState !== saved.agentState) notes.push('AI and rules infer different states');
    if (ai && rules.needsAmi !== saved.needsAmi) notes.push('AI and rules disagree about Ami');
    if (ai && rules.waitingOnType !== saved.waitingOnType) notes.push('AI and rules infer different dependencies');
    if (isDone(task.clickupStatus) && saved.agentState !== 'COMPLETED') flags.push({ priority: true, title: 'ClickUp done but AI finds outstanding work' });
    if (!isDone(task.clickupStatus) && saved.agentState === 'COMPLETED') notes.push('AI says complete while ClickUp remains open');
    if (saved.needsAmi && (!saved.amiAction || !saved.amiAction.trim())) flags.push({ priority: true, title: 'Missing concrete Ami action' });
    if (saved.agentState === 'WAITING_ON_AMI' && (!saved.needsAmi || saved.waitingOnType !== 'AMI')) flags.push({ priority: true, title: 'Inconsistent Ami dependency' });
    if (saved.agentState.startsWith('WAITING_') && saved.waitingOnType === 'NONE') flags.push({ priority: true, title: 'Waiting without dependency' });
    const team = new Set(task.assignees.map(a => a.employee.name.toLowerCase()));
    if ((saved.waitingOnType === 'CLIENT' || saved.waitingOnType === 'VENDOR') && saved.waitingOnName && team.has(saved.waitingOnName.toLowerCase())) flags.push({ priority: true, title: 'Internal assignee labeled external' });
    if (ai && saved.confidence != null && saved.confidence < 0.8) flags.push({ priority: false, title: 'Low model confidence' });
    const feedback = task.reviewFeedback;
    const staleReview = !!feedback && (feedback.analyzedAt?.getTime() ?? 0) !== (saved.analyzedAt?.getTime() ?? 0);
    return { task, rules, saved, ai, flags, notes, feedback, staleReview };
  }).sort((a, b) => Number(b.flags.some(f => f.priority)) - Number(a.flags.some(f => f.priority)) || b.flags.length - a.flags.length);

  const flagged = rows.filter(r => r.flags.length > 0).length;
  const reviewed = rows.filter(r => r.feedback && !r.staleReview).length;
  const critical = rows.filter(r => r.flags.some(f => f.priority)).length;
  const visible = rows.filter(r => filter === 'all' || (filter === 'critical' ? r.flags.some(f => f.priority) : filter === 'unreviewed' ? !r.feedback || r.staleReview : r.flags.length > 0));

  return <main className="ops-shell" style={{ maxWidth: 1100 }}>
    <header className="ops-header">
      <div><p className="eyebrow">QUALITY ASSURANCE · HUMAN REVIEW</p><h1>AI Review</h1>
        <p className="muted">Compare ClickUp, deterministic rules, and saved intelligence. This page makes no OpenAI requests. Feedback is saved locally.</p>
      </div>
      <a className="secondary-link" href="/">Back to dashboard</a>
    </header>
    <section className="metric-grid">
      <div className="metric-card"><span>Tasks with comments</span><strong>{rows.length}</strong></div>
      <div className="metric-card"><span>Saved AI assessments</span><strong>{rows.filter(r => r.ai).length}</strong></div>
      <div className="metric-card"><span>Flagged</span><strong>{flagged}</strong></div>
      <div className="metric-card"><span>Priority review</span><strong>{critical}</strong></div>
      <div className="metric-card"><span>Human reviewed</span><strong>{reviewed}</strong></div>
    </section>
    <nav style={{ display: 'flex', gap: 18, margin: '22px 0' }}>
      <a href="/review?filter=disagreements">Disagreements ({flagged})</a>
      <a href="/review?filter=critical">Priority ({critical})</a>
      <a href="/review?filter=all">All ({rows.length})</a>
      <a href="/review?filter=unreviewed">Unreviewed ({rows.length - reviewed})</a>
    </nav>
    <p className="muted">Rule classifications are recalculated now. Saved AI classifications may be older. Rule/AI differences are informational. Priority flags identify potentially contradictory evidence or inconsistent classifications.</p>
    {!visible.length && <div className="empty-state">No tasks match this filter.</div>}
    {visible.map(({ task, rules, saved, ai, flags, notes, feedback, staleReview }) =>
      <details id={"task-" + task.id} key={task.id} className="ops-section" style={{ padding: 18, marginBottom: 14 }} open={flags.some(f => f.priority)}>
        <summary style={{ cursor: 'pointer' }}><strong>{task.name}</strong> · {task.client.name} · {flags.length} quality flags · {notes.length} informational differences · {feedback && !staleReview ? feedback.verdict : 'Unreviewed'}</summary>
        {flags.map((flag, i) => <p key={i}><strong>{flag.priority ? 'Priority review' : 'Review'}:</strong> {flag.title}</p>)}
        {notes.length > 0 && <details><summary>Expected interpretation differences ({notes.length})</summary>{notes.map((note, i) => <p key={i} className="muted">{note}</p>)}</details>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left', marginTop: 16 }}>
            <thead><tr><th>Field</th><th>ClickUp</th><th>Rules now</th><th>Saved {ai ? 'AI' : 'rules'}</th></tr></thead>
            <tbody>
              <tr><td>State</td><td>{task.clickupStatus ?? 'Unknown'}</td><td>{format(rules.agentState)}</td><td>{format(saved.agentState)}</td></tr>
              <tr><td>Needs Ami</td><td>Not represented</td><td>{rules.needsAmi ? 'Yes' : 'No'}</td><td>{saved.needsAmi ? 'Yes' : 'No'}</td></tr>
              <tr><td>Waiting on</td><td>Not represented</td><td>{format(rules.waitingOnType)} {rules.waitingOnName ?? ''}</td><td>{format(saved.waitingOnType)} {saved.waitingOnName ?? ''}</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>Saved summary:</strong> {saved.currentSummary ?? 'None'}</p>
        {saved.amiAction && <p><strong>Ami action:</strong> {saved.amiAction}</p>}
        <p className="muted">Confidence: {saved.confidence == null ? 'Unknown' : Math.round(saved.confidence * 100) + '%'} · Prompt: {saved.promptVersion ?? 'Unknown'} · Analyzed: {saved.analyzedAt?.toLocaleString('en-US', { timeZone: 'America/New_York' }) ?? 'Unknown'}</p>
        {task.clickupUrl && <p><a href={task.clickupUrl} target="_blank" rel="noreferrer">Open in ClickUp</a></p>}
        <form action={saveReview} style={{ padding: 14, border: '1px solid #ddd', borderRadius: 8, marginBottom: 16 }}>
          <strong>Human evaluation</strong>
          {staleReview && <p className="muted">The saved AI assessment changed since this review. Please evaluate again.</p>}
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="filter" value={filter} />
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '10px 0' }}>
            {([['CORRECT', 'Correct'], ['INCORRECT', 'Incorrect'], ['INVESTIGATE', 'Needs investigation']] as const).map(([value, text]) =>
              <label key={value}><input type="radio" name="verdict" value={value} required defaultChecked={feedback?.verdict === value} /> {text}</label>)}
          </div>
          <label htmlFor={'notes-' + task.id}>Review notes (optional)</label>
          <textarea id={'notes-' + task.id} name="notes" maxLength={2000} rows={2} defaultValue={feedback?.notes ?? ''} style={{ display: 'block', width: '100%', margin: '8px 0' }} />
          <button className="digest-button" type="submit">Save review</button>
        </form>
        <details><summary>Evidence ({task.comments.length} comments)</summary>
          {task.comments.map(c => <div key={c.id} style={{ borderTop: '1px solid #ddd', padding: '10px 0' }}>
            <strong>{c.authorName ?? 'Unknown'}</strong> · {c.clickupCreatedAt?.toLocaleString('en-US', { timeZone: 'America/New_York' }) ?? 'Unknown date'}
            <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
          </div>)}
        </details>
      </details>
    )}
  </main>;
}
