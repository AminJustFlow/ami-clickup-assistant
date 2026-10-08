import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const formatDate = (date: Date | null) => date
  ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(date)
  : '—';

export default async function VothIntelligencePage() {
  const client = await prisma.client.findUnique({ where: { slug: 'voth' } });
  if (!client) return <main><h1>VOTH INTELLIGENCE</h1><p>Run the VOTH sync first.</p></main>;

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false, intelligence: { isNot: null } },
    orderBy: [{ intelligence: { amiAttentionScore: 'desc' } }, { clickupUpdatedAt: 'desc' }],
    include: {
      list: true,
      assignees: { include: { employee: true } },
      intelligence: true,
      comments: { orderBy: { clickupCreatedAt: 'asc' } }
    }
  });

  const needsAmi = tasks.filter((task) => task.intelligence?.needsAmi);
  const waiting = tasks.filter((task) => task.intelligence?.waitingOnType !== 'NONE');
  const panel: React.CSSProperties = { border: '1px solid #d7dce2', borderRadius: 8, padding: 16, marginBottom: 14, background: '#fff' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 };

  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
    <h1>VOTH INTELLIGENCE</h1>
    <p className="muted">Phase 2 shadow view. Rule-derived intelligence only. ClickUp remains the source of truth.</p>

    <section style={{ ...panel, ...grid }}>
      <div><strong>Analyzed</strong><br />{tasks.length}</div>
      <div><strong>Needs Ami</strong><br />{needsAmi.length}</div>
      <div><strong>Waiting</strong><br />{waiting.length}</div>
      <div><strong>Rule version</strong><br />RULE_ENGINE_V1</div>
    </section>

    {tasks.map((task) => {
      const intel = task.intelligence!;
      return <details key={task.id} style={panel} open={intel.needsAmi}>
        <summary style={{ cursor: 'pointer' }}>
          <strong>{task.name}</strong> — {intel.agentState} — Ami {intel.amiAttentionScore}/100
        </summary>
        <div style={{ ...grid, marginTop: 16 }}>
          <div><strong>ClickUp status</strong><br />{task.clickupStatus ?? '—'}</div>
          <div><strong>Agent state</strong><br />{intel.agentState}</div>
          <div><strong>Needs Ami</strong><br />{intel.needsAmi ? 'YES' : 'No'}</div>
          <div><strong>Waiting on</strong><br />{intel.waitingOnType}{intel.waitingOnName ? `: ${intel.waitingOnName}` : ''}</div>
          <div><strong>Importance</strong><br />{intel.importanceScore}/100</div>
          <div><strong>Ami attention</strong><br />{intel.amiAttentionScore}/100</div>
          <div><strong>Risk</strong><br />{intel.riskLevel}</div>
          <div><strong>Confidence</strong><br />{intel.confidence == null ? '—' : `${Math.round(intel.confidence * 100)}%`}</div>
          <div><strong>Analyzed</strong><br />{formatDate(intel.analyzedAt)}</div>
        </div>

        <h3>{intel.headline}</h3>
        <p>{intel.currentSummary}</p>
        {intel.amiAction && <p><strong>Ami action:</strong> {intel.amiAction}</p>}
        {intel.lastMeaningfulChange && <p><strong>Last meaningful change:</strong> {intel.lastMeaningfulChange}</p>}

        <p>
          <strong>Assignees:</strong> {task.assignees.map(({ employee }) => employee.name).join(', ') || '—'}
          {' · '}<strong>List:</strong> {task.list.name}
          {' · '}{task.clickupUrl ? <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open ClickUp</a> : 'No ClickUp URL'}
        </p>

        <h4>Evidence timeline</h4>
        {!task.comments.length && <p>No comments.</p>}
        {task.comments.map((comment) => <article key={comment.id} style={{ borderTop: '1px solid #e4e7eb', padding: '10px 0' }}>
          <strong>{comment.authorName ?? 'Unknown'}</strong> <small>{formatDate(comment.clickupCreatedAt)}</small>
          <div style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
        </article>)}
      </details>;
    })}
  </main>;
}
