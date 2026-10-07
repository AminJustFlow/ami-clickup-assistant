import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const value = (input: string | string[] | undefined) => typeof input === 'string' ? input : '';
const formatDate = (date: Date | null) => date ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(date) : '—';

export default async function VothDebugPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const listId = value(params.list);
  const status = value(params.status);
  const assigneeId = value(params.assignee);
  const hasComments = value(params.comments);
  const search = value(params.q).trim();
  const client = await prisma.client.findUnique({ where: { slug: 'voth' }, include: { space: true } });

  if (!client) return <main><h1>VOTH RAW DATA</h1><p>VOTH has not been imported. Run <code>npm run clickup:sync:voth</code>.</p></main>;

  const baseWhere = { clientId: client.id, deleted: false };
  const where = {
    ...baseWhere,
    ...(listId ? { list: { clickupListId: listId } } : {}),
    ...(status ? { clickupStatus: status } : {}),
    ...(assigneeId ? { assignees: { some: { employee: { clickupUserId: assigneeId } } } } : {}),
    ...(hasComments === 'yes' ? { comments: { some: {} } } : {}),
    ...(hasComments === 'no' ? { comments: { none: {} } } : {}),
    ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { comments: { some: { body: { contains: search, mode: 'insensitive' as const } } } }
    ] } : {})
  };

  const [lists, tasks, totalTasks, totalComments, employeeRows, statusRows] = await Promise.all([
    prisma.clickUpList.findMany({ where: { clientId: client.id, active: true }, orderBy: { name: 'asc' }, include: { _count: { select: { tasks: { where: { deleted: false } } } } } }),
    prisma.task.findMany({ where, orderBy: { clickupUpdatedAt: 'desc' }, include: { list: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } } }),
    prisma.task.count({ where: baseWhere }),
    prisma.comment.count({ where: { task: baseWhere } }),
    prisma.employee.findMany({ where: { assignments: { some: { task: baseWhere } } }, orderBy: { name: 'asc' } }),
    prisma.task.findMany({ where: baseWhere, distinct: ['clickupStatus'], select: { clickupStatus: true }, orderBy: { clickupStatus: 'asc' } })
  ]);

  const panel: React.CSSProperties = { border: '1px solid #d7dce2', borderRadius: 8, padding: 16, marginBottom: 14, background: '#fff' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };
  return <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
    <h1>VOTH RAW DATA</h1>
    <p className="muted">Unmodified ClickUp task and comment data. No AI interpretation is shown.</p>
    <section style={{ ...panel, ...grid }}>
      <div><strong>Folder ID</strong><br />{client.clickupFolderId}</div>
      <div><strong>Space</strong><br />{client.space.name}<br /><small>{client.clickupSpaceId}</small></div>
      <div><strong>Lists</strong><br />{lists.length}</div>
      <div><strong>Tasks</strong><br />{totalTasks}</div>
      <div><strong>Comments</strong><br />{totalComments}</div>
      <div><strong>Employees</strong><br />{employeeRows.length}</div>
      <div><strong>Last Sync</strong><br />{formatDate(client.lastSyncedAt)}</div>
    </section>

    <section style={panel}>
      <h2>Lists</h2>
      <div style={grid}>{lists.map((list) => <div key={list.id}><strong>{list.name}</strong><br />{list._count.tasks} tasks<br /><small>{list.clickupListId}</small></div>)}</div>
    </section>

    <form method="get" style={{ ...panel, ...grid, alignItems: 'end' }}>
      <label>List<br /><select name="list" defaultValue={listId}><option value="">All</option>{lists.map((list) => <option key={list.id} value={list.clickupListId}>{list.name}</option>)}</select></label>
      <label>Status<br /><select name="status" defaultValue={status}><option value="">All</option>{statusRows.map((row) => row.clickupStatus && <option key={row.clickupStatus} value={row.clickupStatus}>{row.clickupStatus}</option>)}</select></label>
      <label>Assignee<br /><select name="assignee" defaultValue={assigneeId}><option value="">All</option>{employeeRows.map((employee) => <option key={employee.id} value={employee.clickupUserId}>{employee.name}</option>)}</select></label>
      <label>Has Comments<br /><select name="comments" defaultValue={hasComments}><option value="">All</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label>Search tasks/comments<br /><input name="q" defaultValue={search} /></label>
      <button type="submit">Filter</button>
    </form>

    <h2>{tasks.length} matching tasks</h2>
    {tasks.map((task) => <details key={task.id} style={panel}>
      <summary style={{ cursor: 'pointer' }}><strong>{task.name}</strong> — {task.list.name} — {task.clickupStatus ?? 'No status'} ({task.comments.length} comments)</summary>
      <div style={{ ...grid, marginTop: 16 }}>
        <div><strong>List</strong><br />{task.list.name}</div><div><strong>Status</strong><br />{task.clickupStatus ?? '—'}</div>
        <div><strong>Priority</strong><br />{task.clickupPriority ?? '—'}</div><div><strong>Assignees</strong><br />{task.assignees.map(({ employee }) => employee.name).join(', ') || '—'}</div>
        <div><strong>Due</strong><br />{formatDate(task.dueDate)}</div><div><strong>Created</strong><br />{formatDate(task.clickupCreatedAt)}</div>
        <div><strong>Updated</strong><br />{formatDate(task.clickupUpdatedAt)}</div><div><strong>ClickUp Task ID</strong><br />{task.clickupTaskId}</div>
        <div><strong>ClickUp URL</strong><br />{task.clickupUrl ? <a href={task.clickupUrl} target="_blank" rel="noreferrer">Open task</a> : '—'}</div>
      </div>
      <h3>COMMENTS</h3>
      {!task.comments.length && <p className="muted">No comments.</p>}
      {task.comments.map((comment) => <article key={comment.id} style={{ borderTop: '1px solid #e4e7eb', padding: '12px 0' }}>
        <strong>{comment.authorName ?? 'Unknown author'}</strong><br /><small>{formatDate(comment.clickupCreatedAt)}</small>
        <p style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</p>
      </article>)}
    </details>)}
  </main>;
}
