import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { analysisClientGroups } from '../lib/intelligence/client-scope';
import { buildTaskContext } from '../lib/intelligence/context';
import { findRelatedTasks } from '../lib/intelligence/related';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
function value(flag: string) { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }
const slug = value('--client');
if (!slug) throw new Error('Pass --client CLIENT_SLUG');
const limit = Number(value('--limit') ?? '5');
if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('--limit must be between 1 and 30');
async function main() {
  const [group] = await analysisClientGroups({ clientSlug: slug });
  const tasks = await prisma.task.findMany({
    where: { clientId: { in: group.folders.map(folder => folder.id) }, deleted: false },
    include: { list: true, client: { select: { name: true } }, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } }
  });
  const contexts = tasks.map(buildTaskContext);
  const byId = new Map(contexts.map(context => [context.clickupTaskId, context]));
  const samples = contexts.filter(context => (context.dependencyTaskIds ?? []).some(id => byId.has(id))).slice(0, limit);
  console.log('READ-ONLY RELATED TASK EVIDENCE AUDIT: ' + group.canonical.name);
  console.log(tasks.length + ' tasks across ' + group.folders.length + ' folders. No AI/API calls or DB writes.');
  for (const context of samples) {
    console.log('\n' + context.name + ' [' + context.clickupTaskId + '] / ' + context.listName);
    console.log('  Exact dependency IDs: ' + (context.dependencyTaskIds ?? []).join(', '));
    const related = findRelatedTasks(context, contexts);
    for (const item of related) {
      console.log('  RELATED [' + item.context.clickupTaskId + '] ' + item.context.name + ' | ' + item.reason + ' | ' + item.context.status);
    }
  }
  if (!samples.length) console.log('No sample with a resolved dependency found.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
