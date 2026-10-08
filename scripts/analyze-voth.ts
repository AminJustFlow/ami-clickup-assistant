import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { buildTaskContext } from '../lib/intelligence/context';
import { analyzeWithRules } from '../lib/intelligence/engine';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const client = await prisma.client.findUnique({ where: { slug: 'voth' } });
  if (!client) throw new Error('VOTH not found. Run npm run clickup:sync:voth first.');

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false },
    include: {
      list: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } }
    }
  });

  const counts = new Map<string, number>();
  let needsAmi = 0;
  for (const task of tasks) {
    // Preserve richer AI classifications; this script only initializes tasks without AI results.
    const prior = await prisma.taskIntelligence.findUnique({ where: { taskId: task.id } });
    if (prior?.promptVersion?.startsWith('TASK_ANALYZER_')) continue;
    const result = analyzeWithRules(buildTaskContext(task));
    counts.set(result.agentState, (counts.get(result.agentState) ?? 0) + 1);
    if (result.needsAmi) needsAmi += 1;

    await saveTaskIntelligence(task.id, {agentState: result.agentState,
        headline: result.headline,
        currentSummary: result.currentSummary,
        needsAmi: result.needsAmi,
        amiAction: result.amiAction,
        waitingOnType: result.waitingOnType,
        waitingOnName: result.waitingOnName,
        importanceScore: result.importanceScore,
        amiAttentionScore: result.amiAttentionScore,
        riskLevel: result.riskLevel,
        lastMeaningfulChange: result.lastMeaningfulChange,
        lastMeaningfulChangeAt: result.lastMeaningfulChangeAt,
        confidence: result.confidence,
        promptVersion: 'RULE_ENGINE_V1',
        analyzedAt: new Date()
    });
  }

  console.log(`Analyzed ${tasks.length} VOTH tasks.`);
  console.log(`Needs Ami: ${needsAmi}`);
  for (const [state, count] of [...counts].sort()) console.log(`  ${state}: ${count}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
