import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/db/prisma';
import { parseCostOptions, calculateCostPlan, printCostPlan } from '../lib/intelligence/cost-plan';
import { buildTaskContext } from '../lib/intelligence/context';
import { intelligenceFingerprint } from '../lib/intelligence/fingerprint';
import { findRelatedTasks } from '../lib/intelligence/related';
import { analyzeWithAI } from '../lib/intelligence/ai';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { TASK_ANALYZER_PROMPT_VERSION } from '../lib/intelligence/prompt';
import { analysisClientGroups } from '../lib/intelligence/client-scope';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
function value(flag: string) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
const maxAI = Number(value('--max-ai') ?? '50');
if (!Number.isInteger(maxAI) || maxAI < 1 || maxAI > 10000) throw new Error('--max-ai must be between 1 and 10000');

async function main() {
  const options = parseCostOptions(args);
  const plan = await calculateCostPlan(options);
  printCostPlan(plan, options);
  if (!args.includes('--execute')) {
    console.log('DRY RUN: no OpenAI calls made. To proceed pass --execute and --max-usd AMOUNT.');
    return;
  }
  const budget = Number(value('--max-usd'));
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('Execution requires --max-usd with a positive amount.');
  const upperEstimate = Math.min(maxAI, plan.pending) *
    ((plan.maxTaskInputTokens * options.inputRate + options.outputTokens * options.outputRate) / 1_000_000);
  if (upperEstimate > budget) {
    throw new Error('Estimated worst-case batch USD ' + upperEstimate.toFixed(2) + ' exceeds budget USD ' + budget.toFixed(2) + '. Reduce --max-ai or adjust budget.');
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  console.log('EXECUTION APPROVED: at most ' + maxAI + ' attempts; conservative estimated upper batch cost USD ' + upperEstimate.toFixed(2) + '. Not a guaranteed billing cap.');

  const clients = await analysisClientGroups(options);
  const model = plan.model;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(e => e.name);
  let analyzed = 0, attempted = 0, cached = 0, failed = 0;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: { in: client.folders.map(folder => folder.id) }, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } },
      orderBy: { clickupUpdatedAt: 'desc' }
    });
    const contexts = tasks.map(buildTaskContext);
    console.log('\nCLIENT ' + client.canonical.name + ' (' + client.canonical.slug + ') · ' + tasks.length + ' tasks across ' + client.folders.length + ' folders');
    for (const task of tasks) {
      if (options.taskIds.length && !options.taskIds.includes(task.clickupTaskId)) continue;
      const context = buildTaskContext(task);
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
        cached++;
        continue;
      }
      if (attempted >= maxAI) {
        console.log('AI attempt limit reached. Rerun to continue.');
        console.log(JSON.stringify({ attempted, analyzed, cached, failed }));
        return;
      }
      try {
        attempted++;
        const result = await analyzeWithAI(context, { model, teamNames, related });
        if (result.source !== 'AI') throw new Error('AI fallback; will retry on next run');
        await saveTaskIntelligence(task.id, {
          agentState: result.agentState, headline: result.headline,
          currentSummary: result.currentSummary, needsAmi: result.needsAmi, amiAction: result.amiAction,
          waitingOnType: result.waitingOnType, waitingOnName: result.waitingOnName,
          importanceScore: result.importanceScore, amiAttentionScore: result.amiAttentionScore,
          riskLevel: result.riskLevel, lastMeaningfulChange: result.lastMeaningfulChange,
          lastMeaningfulChangeAt: result.lastMeaningfulChangeAt, confidence: result.confidence,
          promptVersion: expectedVersion, analyzedAt: new Date(), sourceFingerprint: fingerprint
        });
        analyzed++;
        console.log('  [AI] ' + task.name + ' · ' + result.agentState + (result.needsAmi ? ' · NEEDS AMI' : ''));
      } catch (error) {
        failed++;
        console.error('  [FAILED] ' + task.name + ': ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  console.log(JSON.stringify({ attempted, analyzed, cached, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
