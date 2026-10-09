import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db/prisma';
import { buildTaskContext } from '../lib/intelligence/context';
import { intelligenceFingerprint } from '../lib/intelligence/fingerprint';
import { findRelatedTasks } from '../lib/intelligence/related';
import { analyzeWithAI } from '../lib/intelligence/ai';
import { saveTaskIntelligence } from '../lib/intelligence/change-history';
import { TASK_ANALYZER_PROMPT_VERSION } from '../lib/intelligence/prompt';
import { groupClientFolders } from '../lib/clients/grouping';

loadEnvConfig(process.cwd());
const once = process.argv.includes('--once');
const workerId = randomUUID();
const model = process.env.OPENAI_INTELLIGENCE_MODEL || 'gpt-5.6-luna';
const dailyBudget = Number(process.env.AI_DAILY_BUDGET_USD);
const batchBudget = Number(process.env.AI_BATCH_BUDGET_USD);
const maxJobs = Number(process.env.AI_MAX_ATTEMPTS_PER_CYCLE || '10');
const maxRetries = Number(process.env.AI_MAX_JOB_RETRIES || '3');
const inputRate = Number(process.env.AI_INPUT_USD_PER_MILLION);
const outputRate = Number(process.env.AI_OUTPUT_USD_PER_MILLION);
const intervalSeconds = Number(process.env.AI_WORKER_INTERVAL_SECONDS || '60');
const maxInputTokens = Number(process.env.AI_MAX_INPUT_TOKENS_PER_TASK || '20000');
const maxOutputTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS_PER_TASK || '2000');
for (const [name, value] of Object.entries({ dailyBudget, batchBudget, maxJobs, maxRetries, inputRate, outputRate, intervalSeconds, maxInputTokens, maxOutputTokens })) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + ' must be a positive number');
}
if (batchBudget > dailyBudget) throw new Error('AI_BATCH_BUDGET_USD cannot exceed AI_DAILY_BUDGET_USD');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
const reservation = Math.ceil(((maxInputTokens * inputRate + maxOutputTokens * outputRate) / 1_000_000) * 1_000_000) / 1_000_000;
if (reservation > batchBudget) throw new Error('One task reservation exceeds AI_BATCH_BUDGET_USD');

let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const day = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

async function refreshQueue() {
  const teamNames = (await prisma.employee.findMany({ select: { name: true } })).map(x => x.name);
  // Bounded discovery keeps the worker viable on a 2 GB host. The definitive
  // fingerprint is calculated with full client-group context after leasing.
  const expectedVersion = TASK_ANALYZER_PROMPT_VERSION + ':' + model;
  const candidates = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT t.id FROM "Task" t LEFT JOIN "TaskIntelligence" i ON i."taskId" = t.id
    WHERE t.deleted = false AND (i.id IS NULL OR i."analyzedAt" IS NULL OR i."promptVersion" IS DISTINCT FROM ${expectedVersion}
      OR t."clickupUpdatedAt" > i."analyzedAt")
    ORDER BY COALESCE(i."needsAmi", false) DESC, COALESCE(i."amiAttentionScore", 0) DESC, t."clickupUpdatedAt" DESC NULLS LAST
    LIMIT 500`;
  for (const task of candidates) {
    const existing = await prisma.analysisJob.findUnique({ where: { taskId: task.id }, select: { status: true } });
    if (!existing) await prisma.analysisJob.create({ data: { taskId: task.id } });
    else if (existing.status === 'SUCCEEDED') await prisma.analysisJob.update({ where: { taskId: task.id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
  }
  return teamNames;
}

async function leaseJob() {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: number; taskId: number }>>`
      SELECT id, "taskId" FROM "AnalysisJob"
      WHERE (status = 'PENDING' OR (status = 'LEASED' AND "leaseExpiresAt" < NOW()))
        AND "nextAttemptAt" <= NOW() AND attempts < ${maxRetries}
      ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
    const job = rows[0]; if (!job) return null;
    await tx.aiBudgetDay.upsert({ where: { day: day() }, create: { day: day() }, update: {} });
    const reserved = await tx.$executeRaw`UPDATE "AiBudgetDay" SET "reservedUsd" = "reservedUsd" + ${reservation}, "updatedAt" = NOW() WHERE day = ${day()} AND "reservedUsd" + ${reservation} <= ${dailyBudget}`;
    if (!reserved) {
      const tomorrow = new Date(day().getTime() + 24 * 60 * 60_000);
      await tx.analysisJob.update({ where: { id: job.id }, data: { status: 'PAUSED_BUDGET', nextAttemptAt: tomorrow } }); return null;
    }
    await tx.analysisJob.update({ where: { id: job.id }, data: { status: 'LEASED', leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 15 * 60_000), attempts: { increment: 1 }, estimatedReservedUsd: reservation } });
    return job;
  });
}

async function processJob(job: { id: number; taskId: number }, teamNames: string[]) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: job.taskId }, include: { list: true, intelligence: true, assignees: { include: { employee: true } }, comments: { orderBy: { clickupCreatedAt: 'asc' } } } });
  const clientRows = await prisma.client.findMany({ where: { active: true }, select: { id: true, slug: true, name: true, clickupFolderId: true } });
  const group = groupClientFolders(clientRows).find(item => item.folders.some(folder => folder.id === task.clientId));
  const scopeIds = group?.folders.map(folder => folder.id) ?? [task.clientId];
  const scopeTasks = await prisma.task.findMany({
    where: { clientId: { in: scopeIds }, deleted: false },
    include: {
      list: true,
      intelligence: true,
      assignees: { include: { employee: true } },
      comments: { orderBy: { clickupCreatedAt: 'asc' } }
    }
  });
  const context = buildTaskContext(task); const related = findRelatedTasks(context, scopeTasks.map(buildTaskContext));
  try {
    const result = await analyzeWithAI(context, { model, teamNames, related });
    if (result.source !== 'AI') throw new Error('OpenAI analysis did not complete');
    const fingerprint = intelligenceFingerprint(context, model, teamNames, related);
    await saveTaskIntelligence(task.id, { agentState: result.agentState, headline: result.headline, currentSummary: result.currentSummary, needsAmi: result.needsAmi, amiAction: result.amiAction, waitingOnType: result.waitingOnType, waitingOnName: result.waitingOnName, importanceScore: result.importanceScore, amiAttentionScore: result.amiAttentionScore, riskLevel: result.riskLevel, lastMeaningfulChange: result.lastMeaningfulChange, lastMeaningfulChangeAt: result.lastMeaningfulChangeAt, confidence: result.confidence, promptVersion: TASK_ANALYZER_PROMPT_VERSION + ':' + model, analyzedAt: new Date(), sourceFingerprint: fingerprint });
    const input = result.usage?.inputTokens ?? 0, output = result.usage?.outputTokens ?? 0;
    const actual = (input * inputRate + output * outputRate) / 1_000_000;
    await prisma.$transaction([
      prisma.analysisJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', leaseOwner: null, leaseExpiresAt: null, actualInputTokens: input, actualOutputTokens: output, actualEstimatedUsd: actual, completedAt: new Date(), lastError: null } }),
      prisma.aiBudgetDay.update({ where: { day: day() }, data: { actualEstimatedUsd: { increment: actual }, inputTokens: { increment: input }, outputTokens: { increment: output }, successfulJobs: { increment: 1 } } })
    ]);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const current = await prisma.analysisJob.findUniqueOrThrow({ where: { id: job.id } });
    const terminal = current.attempts >= maxRetries;
    await prisma.$transaction([
      prisma.analysisJob.update({ where: { id: job.id }, data: { status: terminal ? 'FAILED' : 'PENDING', leaseOwner: null, leaseExpiresAt: null, lastError: message, nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * (2 ** current.attempts)) * 1000) } }),
      prisma.aiBudgetDay.update({ where: { day: day() }, data: { failedJobs: { increment: 1 } } })
    ]);
  }
}

async function cycle() {
  await prisma.analysisJob.updateMany({ where: { status: 'PAUSED_BUDGET', nextAttemptAt: { lte: new Date() } }, data: { status: 'PENDING' } });
  const teamNames = await refreshQueue(); let attempts = 0; let batchReserved = 0;
  while (!stopping && attempts < maxJobs && batchReserved + reservation <= batchBudget + 1e-9) { const job = await leaseJob(); if (!job) break; attempts++; batchReserved += reservation; await processJob(job, teamNames); }
  const counts = await prisma.analysisJob.groupBy({ by: ['status'], _count: true });
  await prisma.workerHeartbeat.upsert({ where: { name: 'ai-worker' }, create: { name: 'ai-worker', status: 'IDLE', lastStartedAt: new Date(), lastSeenAt: new Date(), lastSuccessAt: new Date(), metadata: { counts } }, update: { status: 'IDLE', lastSeenAt: new Date(), lastSuccessAt: new Date(), lastError: null, metadata: { counts } } });
}
async function main() { do { await cycle(); if (once || stopping) break; await new Promise(r => setTimeout(r, intervalSeconds * 1000)); } while (!stopping); }
main().catch(async error => { console.error(error); await prisma.workerHeartbeat.upsert({ where: { name: 'ai-worker' }, create: { name: 'ai-worker', status: 'FAILED', lastSeenAt: new Date(), lastError: String(error) }, update: { status: 'FAILED', lastSeenAt: new Date(), lastError: String(error) } }); process.exitCode = 1; }).finally(() => prisma.$disconnect());
