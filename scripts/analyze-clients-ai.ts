import { loadEnvConfig } from '@next/env';
import { parseCostOptions, calculateCostPlan, printCostPlan } from '../lib/intelligence/cost-plan';
import { prisma } from '../lib/db/prisma';
import { buildTaskContext } from '../lib/intelligence/context';
import { intelligenceFingerprint } from '../lib/intelligence/fingerprint';
import { findRelatedTasks } from '../lib/intelligence/related';
import { analyzeWithAI, DEFAULT_INTELLIGENCE_MODEL } from '../lib/intelligence/ai';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { TASK_ANALYZER_PROMPT_VERSION } from '../lib/intelligence/prompt';

loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
function value(flag: string) { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; }
const clientSlug = value('--client');
const maxArg = value('--max-ai') ?? '50';
const maxAI = Number(maxArg);
if (!Number.isInteger(maxAI) || maxAI < 1 || maxAI > 10000) throw new Error('--max-ai must be between 1 and 10000');

async function main() {
  const options = parseCostOptions(args);
  const plan = await calculateCostPlan(options);
  printCostPlan(plan, options);
  if (!args.includes('--execute')) {
    console.log('DRY RUN: No OpenAI calls made. To proceed, pass --execute and --max-usd AMOUNT after reviewing the estimate.');
    return;
  }
  const budget = Number(value('--max-usd'));
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('Execution requires --max-usd with a positive amount.');
  const upperEstimate = Math.min(maxAI, plan.pending) * ((plan.maxTaskInputTokens * options.inputRate + options.outputTokens * options.outputRate) / 1_000_000);
  if (upperEstimate > budget) throw new Error('Estimated worst-case batch  throw new Error('OPENAI_API_KEY is required');
  const clients = await prisma.client.findMany({
    where: { active: true, ...(clientSlug ? { slug: clientSlug } : options.includeVoth ? {} : { slug: { not: 'voth' } }) },
    orderBy: { name: 'asc' }
  });
  if (!clients.length) throw new Error('No imported clients found. Import clients first, or check --client slug.');
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  let analyzed = 0, cached = 0, failed = 0;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: client.id, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } },
      orderBy: [{ clickupUpdatedAt: 'desc' }]
    });
    const contexts = tasks.map(buildTaskContext);
    console.log('\nCLIENT ' + client.name + ' (' + client.slug + ') · ' + tasks.length + ' tasks');
    for (const task of tasks) {
      const context = buildTaskContext(task);
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
        cached++;
        continue;
      }
      if (analyzed >= maxAI) {
        console.log('AI call limit reached (' + maxAI + '). Rerun to continue.');
        console.log(JSON.stringify({ analyzed, cached, failed }));
        return;
      }
      try {
        const result = await analyzeWithAI(context, { model, teamNames, related });
        if (result.source !== 'AI') throw new Error('AI fallback; task will be retried next run');
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
  console.log(JSON.stringify({ analyzed, cached, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
 + upperEstimate.toFixed(2) + ' exceeds --max-usd  throw new Error('OPENAI_API_KEY is required');
  const clients = await prisma.client.findMany({
    where: { active: true, ...(clientSlug ? { slug: clientSlug } : { slug: { not: 'voth' } }) },
    orderBy: { name: 'asc' }
  });
  if (!clients.length) throw new Error('No imported clients found. Import clients first, or check --client slug.');
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  let analyzed = 0, cached = 0, failed = 0;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: client.id, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } },
      orderBy: [{ clickupUpdatedAt: 'desc' }]
    });
    const contexts = tasks.map(buildTaskContext);
    console.log('\nCLIENT ' + client.name + ' (' + client.slug + ') · ' + tasks.length + ' tasks');
    for (const task of tasks) {
      const context = buildTaskContext(task);
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
        cached++;
        continue;
      }
      if (analyzed >= maxAI) {
        console.log('AI call limit reached (' + maxAI + '). Rerun to continue.');
        console.log(JSON.stringify({ analyzed, cached, failed }));
        return;
      }
      try {
        const result = await analyzeWithAI(context, { model, teamNames, related });
        if (result.source !== 'AI') throw new Error('AI fallback; task will be retried next run');
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
  console.log(JSON.stringify({ analyzed, cached, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
 + budget.toFixed(2) + '. Reduce --max-ai or adjust budget. This is an estimate, not a guaranteed spending cap.');
  console.log('EXECUTION APPROVED: max ' + maxAI + ' successful analyses, estimated worst-case  throw new Error('OPENAI_API_KEY is required');
  const clients = await prisma.client.findMany({
    where: { active: true, ...(clientSlug ? { slug: clientSlug } : { slug: { not: 'voth' } }) },
    orderBy: { name: 'asc' }
  });
  if (!clients.length) throw new Error('No imported clients found. Import clients first, or check --client slug.');
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  let analyzed = 0, cached = 0, failed = 0;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: client.id, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } },
      orderBy: [{ clickupUpdatedAt: 'desc' }]
    });
    const contexts = tasks.map(buildTaskContext);
    console.log('\nCLIENT ' + client.name + ' (' + client.slug + ') · ' + tasks.length + ' tasks');
    for (const task of tasks) {
      const context = buildTaskContext(task);
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
        cached++;
        continue;
      }
      if (analyzed >= maxAI) {
        console.log('AI call limit reached (' + maxAI + '). Rerun to continue.');
        console.log(JSON.stringify({ analyzed, cached, failed }));
        return;
      }
      try {
        const result = await analyzeWithAI(context, { model, teamNames, related });
        if (result.source !== 'AI') throw new Error('AI fallback; task will be retried next run');
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
  console.log(JSON.stringify({ analyzed, cached, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
 + upperEstimate.toFixed(2) + ' (not a hard API billing cap).');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const clients = await prisma.client.findMany({
    where: { active: true, ...(clientSlug ? { slug: clientSlug } : { slug: { not: 'voth' } }) },
    orderBy: { name: 'asc' }
  });
  if (!clients.length) throw new Error('No imported clients found. Import clients first, or check --client slug.');
  const model = process.env.OPENAI_INTELLIGENCE_MODEL ?? DEFAULT_INTELLIGENCE_MODEL;
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  let analyzed = 0, cached = 0, failed = 0;
  for (const client of clients) {
    const tasks = await prisma.task.findMany({
      where: { clientId: client.id, deleted: false },
      include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } },
      orderBy: [{ clickupUpdatedAt: 'desc' }]
    });
    const contexts = tasks.map(buildTaskContext);
    console.log('\nCLIENT ' + client.name + ' (' + client.slug + ') · ' + tasks.length + ' tasks');
    for (const task of tasks) {
      const context = buildTaskContext(task);
      const related = findRelatedTasks(context, contexts);
      const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
      if (task.intelligence?.sourceFingerprint === fingerprint && task.intelligence.promptVersion === expectedVersion) {
        cached++;
        continue;
      }
      if (analyzed >= maxAI) {
        console.log('AI call limit reached (' + maxAI + '). Rerun to continue.');
        console.log(JSON.stringify({ analyzed, cached, failed }));
        return;
      }
      try {
        const result = await analyzeWithAI(context, { model, teamNames, related });
        if (result.source !== 'AI') throw new Error('AI fallback; task will be retried next run');
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
  console.log(JSON.stringify({ analyzed, cached, failed }));
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
