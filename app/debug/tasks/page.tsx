import { prisma } from '@/lib/db/prisma';
export const dynamic = 'force-dynamic';
export default async function DebugTasks() {
  const tasks = await prisma.task.findMany({ take: 100, orderBy: { clickupUpdatedAt: 'desc' }, include: { client: true, list: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'desc' }, take: 1 } } });
  return <main><h1>Raw ClickUp Data</h1><p className="muted">This page intentionally shows source data before AI interpretation.</p><table><thead><tr><th>Client</th><th>List</th><th>Task</th><th>Status</th><th>Priority</th><th>Assignees</th><th>Latest comment</th></tr></thead><tbody>{tasks.map(t => <tr key={t.id}><td>{t.client.name}</td><td>{t.list.name}</td><td><a href={t.clickupUrl ?? '#'} target="_blank">{t.name}</a></td><td>{t.clickupStatus}</td><td>{t.clickupPriority}</td><td>{t.assignees.map(a=>a.employee.name).join(', ')}</td><td>{t.comments[0]?.body?.slice(0,160)}</td></tr>)}</tbody></table></main>;
}
