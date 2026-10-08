import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { buildTaskContext } from '../lib/intelligence/context';
import { analyzeWithAI } from '../lib/intelligence/ai';
import { analyzeWithRules } from '../lib/intelligence/engine';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing. Add it to .env before running AI analysis.');

  const client = await prisma.client.findUnique({ where: { slug: 'voth' } });
  if (!client) throw new Error('VOTH not found. Run npm run clickup:sync:voth first.');

  const tasks = await prisma.task.findMany({
    where: { clientId: client.id, deleted: false, comments: { some: {} } },
    include: {
      list: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } }
    },
    orderBy: { clickupUpdatedAt: 'desc' }
  });

  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(e => e.name);
  const counts = new Map<string, number>();
  let needsAmi = 0;
  let aiCount = 0;
  let fallbackCount = 0;

  for (const task of tasks) {
    const context = buildTaskContext(task);
    const rules = analyzeWithRules(context);
    const result = await analyzeWithAI(context, { teamNames });
    counts.set(result.agentState, (counts.get(result.agentState) ?? 0) + 1);
    if (result.needsAmi) needsAmi += 1;
    if (result.source === 'AI') aiCount += 1;
    else fallbackCount += 1;

    await saveTaskIntelligence(task.id, {agentState: result.agentState, headline: result.headline,
        currentSummary: result.currentSummary, needsAmi: result.needsAmi, amiAction: result.amiAction,
        waitingOnType: result.waitingOnType, waitingOnName: result.waitingOnName,
        importanceScore: result.importanceScore, amiAttentionScore: result.amiAttentionScore,
        riskLevel: result.riskLevel, lastMeaningfulChange: result.lastMeaningfulChange,
        lastMeaningfulChangeAt: result.lastMeaningfulChangeAt, confidence: result.confidence,
        promptVersion: `${result.promptVersion}:${result.model ?? 'rules'}`, analyzedAt: new Date()
    });

    console.log(`[${result.source}] ${task.name}`);
    console.log(`  ClickUp: ${task.clickupStatus ?? 'unknown'} | AI confidence: ${result.confidence.toFixed(2)}`);
    if (rules.agentState !== result.agentState || rules.needsAmi !== result.needsAmi || rules.waitingOnType !== result.waitingOnType) {
      console.log(`  CHANGE rules: ${rules.agentState} / Ami=${rules.needsAmi} / ${rules.waitingOnType}`);
      console.log(`          AI: ${result.agentState} / Ami=${result.needsAmi} / ${result.waitingOnType}`);
    }
    console.log(`  ${result.agentState} | Needs Ami: ${result.needsAmi ? 'YES' : 'no'} | Waiting: ${result.waitingOnType}${result.waitingOnName ? ` (${result.waitingOnName})` : ''}`);
    console.log(`  ${result.currentSummary}`);
    if (result.amiAction) console.log(`  Ami action: ${result.amiAction}`);
  }

  console.log(`
AI analyzed ${tasks.length} VOTH tasks with comments.`);
  console.log(`AI results: ${aiCount}; rule fallbacks: ${fallbackCount}; Needs Ami: ${needsAmi}`);
  for (const [state, count] of [...counts].sort()) console.log(`  ${state}: ${count}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
