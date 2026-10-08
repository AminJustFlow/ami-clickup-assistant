import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { buildTaskContext } from '../lib/intelligence/context';
import { findRelatedTasks } from '../lib/intelligence/related';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const client = await prisma.client.findUnique({ where: { slug: 'voth' } });
  if (!client) throw new Error('VOTH not found; sync ClickUp first.');
  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false },
    include: { list: true, intelligence: true, assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } } },
    orderBy: { clickupUpdatedAt: 'desc' }
  });
  const contexts = tasks.map(buildTaskContext);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const explicit = new Set(['Amenities', 'New Client Setup', 'Home Page', 'The Village']);
  const flagged = contexts.filter(c => {
    const i = byId.get(c.taskId)?.intelligence;
    if (!i) return false;
    const done = /^(done|closed|complete|completed)$/i.test(c.status?.trim() ?? '');
    const suspiciousDone = done && i.agentState !== 'COMPLETED';
    const uncertain = i.agentState === 'NEEDS_REVIEW';
    const requested = i.needsAmi;
    return suspiciousDone || uncertain || requested || explicit.has(c.name);
  });
  console.log(`VOTH diagnostic audit: ${flagged.length} tasks from ${tasks.length}; no AI calls, no writes.\n`);
  for (const c of flagged) {
    const i = byId.get(c.taskId)!.intelligence!;
    const related = findRelatedTasks(c, contexts);
    console.log('='.repeat(90));
    console.log(`${c.name} | ClickUp ID ${c.clickupTaskId} | list ${c.listName}`);
    console.log(`ClickUp: ${c.status ?? 'unknown'} | AI: ${i.agentState} | needs Ami: ${i.needsAmi} | confidence: ${i.confidence ?? 'unknown'}`);
    console.log(`AI version: ${i.promptVersion ?? 'unknown'} | last analyzed: ${i.analyzedAt?.toISOString() ?? 'unknown'}`);
    console.log(`Summary: ${i.currentSummary ?? 'none'}`);
    if (i.amiAction) console.log(`Ami action: ${i.amiAction}`);
    console.log(`Description: ${c.description ?? '(none)'}`);
    console.log('Original comments (chronological):');
    for (const comment of c.comments) {
      console.log(`  [${comment.createdAt?.toISOString() ?? 'unknown'}] ${comment.authorName ?? 'Unknown'}: ${comment.body}`);
    }
    if (!c.comments.length) console.log('  (none)');
    console.log('Related task candidates (not assumed dependencies):');
    for (const r of related) {
      console.log(`  ${r.context.clickupTaskId} | ${r.context.name} | ${r.context.status ?? 'unknown'} | ${r.reason}`);
      for (const comment of r.context.comments.slice(-8)) {
        console.log(`    [${comment.createdAt?.toISOString() ?? 'unknown'}] ${comment.authorName ?? 'Unknown'}: ${comment.body}`);
      }
    }
    if (!related.length) console.log('  (none)');
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
