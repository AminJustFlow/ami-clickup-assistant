import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';

const KEYWORDS = ['all set', 'live', 'published', 'fixed', 'completed', 'done', 'updated', 'good to go', 'waiting', 'waiting to hear', 'reached out', 'sent to', 'followed up', 'ami', 'review', 'approve', 'approval', 'what do you think', 'confirm', 'error', 'issue', 'still', 'not working', 'blocked', 'problem'];

function duplicateCount(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const client = await prisma.client.findUnique({
    where: { slug: 'voth' },
    include: { space: true, lists: { where: { active: true }, orderBy: { name: 'asc' } } }
  });
  if (!client) throw new Error('VOTH Client not found. Run npm run clickup:sync:voth first.');

  const taskWhere = { clientId: client.id, deleted: false };
  const [tasks, employees, assigneeCount, comments, tasksWithComments] = await Promise.all([
    prisma.task.findMany({ where: taskWhere, select: { id: true, clickupTaskId: true, clickupStatus: true, listId: true, clientId: true, list: { select: { name: true } } } }),
    prisma.employee.count({ where: { assignments: { some: { task: { clientId: client.id, deleted: false } } } } }),
    prisma.taskAssignee.count({ where: { task: taskWhere } }),
    prisma.comment.findMany({ where: { task: taskWhere }, select: { clickupCommentId: true } }),
    prisma.task.count({ where: { ...taskWhere, comments: { some: {} } } })
  ]);

  const byList = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const task of tasks) {
    byList.set(task.list.name, (byList.get(task.list.name) ?? 0) + 1);
    const status = task.clickupStatus ?? '(none)';
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  const missingList = tasks.filter((task) => !task.listId).length;
  const missingClient = tasks.filter((task) => !task.clientId).length;

  console.log('VOTH RAW DATA VALIDATION');
  console.log(`Client found: ${client.name}`);
  console.log(`Folder ID: ${client.clickupFolderId}`);
  console.log(`Space: ${client.space.name} (${client.clickupSpaceId})`);
  console.log(`Number of Lists: ${client.lists.length}`);
  console.log('\nTasks by List:');
  for (const list of client.lists) console.log(`  ${list.name}: ${byList.get(list.name) ?? 0}`);
  console.log('\nTasks by ClickUp status:');
  for (const [status, count] of [...byStatus].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${status}: ${count}`);
  console.log(`\nNumber of employees: ${employees}`);
  console.log(`Number of task-assignee relationships: ${assigneeCount}`);
  console.log(`Number of comments: ${comments.length}`);
  console.log(`Tasks with comments: ${tasksWithComments}`);
  console.log(`Tasks without comments: ${tasks.length - tasksWithComments}`);
  console.log(`Tasks with missing List: ${missingList}`);
  console.log(`Tasks with missing client: ${missingClient}`);
  console.log(`Duplicate ClickUp Task IDs: ${duplicateCount(tasks.map((task) => task.clickupTaskId))}`);
  console.log(`Duplicate ClickUp Comment IDs: ${duplicateCount(comments.map((comment) => comment.clickupCommentId))}`);

  const examples = await prisma.comment.findMany({
    where: {
      task: taskWhere,
      OR: KEYWORDS.map((keyword) => ({ body: { contains: keyword, mode: 'insensitive' as const } }))
    },
    orderBy: { clickupCreatedAt: 'desc' },
    take: 20,
    include: { task: { include: { list: true } } }
  });
  console.log('\nPOTENTIAL INTELLIGENCE EXAMPLES (keyword search only; not classified)');
  if (!examples.length) console.log('  No keyword matches found.');
  for (const [index, comment] of examples.entries()) {
    const compact = comment.body.replace(/\s+/g, ' ').trim();
    console.log(`\n${index + 1}. ${comment.task.name}`);
    console.log(`   List: ${comment.task.list.name} | Task ID: ${comment.task.clickupTaskId}`);
    console.log(`   ${comment.authorName ?? 'Unknown'}: ${compact.slice(0, 500)}`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
